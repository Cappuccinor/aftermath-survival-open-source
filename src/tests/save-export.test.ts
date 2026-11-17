import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPersistenceController } from '../application/persistence';
import { createLifecyclePrototype } from '../core/npc-lifecycle-prototype';
import { createEngine } from '../core/engine';
import { encodeSave, decodeSave } from '../adapters/storage/save-format';
import type { ManualSaveStore, SlotContents, ExportSnapshot, SaveResult } from '../adapters/storage/port';
import type { ManualSlotId } from '../application/ports';
import type { DownloadPort, PreparedDownload } from '../application/save-export';

const world = (id = 'export-world') => { const w = createLifecyclePrototype(1); return createEngine({ ...w, campaign: { ...w.campaign, saveId: id } }).snapshot(); };
const empty = (): SlotContents => ({ token: null, document: null, previous: null });
function setup(timeoutMs = 5000) {
  const slots = new Map<ManualSlotId, SlotContents>(), texts = new Map<ManualSlotId, string>(); let writes = 0, reads = 0;
  const files: { text: string; filename: string }[] = [], prepared: PreparedDownload[] = [];
  const download: DownloadPort = { prepare: vi.fn(async file => {
    const lease = { start: vi.fn(() => { files.push(file); }), dispose: vi.fn() }; prepared.push(lease); return lease;
  }) };
  const port: ManualSaveStore = {
    read: async id => ({ ok: true, value: slots.get(id) ?? empty() }),
    write: async (w, r) => {
      writes++; const old = slots.get(r.slotId) ?? empty(); if (old.token !== r.expectedToken) return { ok: false, code: 'conflict' };
      const text = await encodeSave(w, { gameBuild: 'test', savedAtUtc: '2026-10-25T00:00:00.000Z' });
      const slot = { token: 'token-' + writes, previous: old.document, document: await decodeSave(text) }; slots.set(r.slotId, slot); texts.set(r.slotId, text); return { ok: true, value: slot };
    },
    exportCurrent: async id => { reads++; const slot = slots.get(id); return slot?.document ? { ok: true, value: { slotId: id, token: slot.token!, text: texts.get(id)!, kind: 'valid', worldRevision: slot.document.worldRevision } } : { ok: false, code: 'empty' }; },
  };
  const controller = createPersistenceController(port, { download, timeoutMs });
  return { c: controller, port, download, slots, texts, files, prepared, writes: () => writes, reads: () => reads };
}
const preserved = (c: ReturnType<typeof createPersistenceController>) => {
  const v = c.client.read(); return { phase: v.phase, message: v.message, saved: v.savedToSelected, current: v.currentDescription, autosave: v.autosave, slots: v.slots };
};
afterEach(() => vi.useRealTimers());
describe('read-only saved-current file export', () => {
  it('exports before entering a world, uses safe filename, passes exact persisted text only', async () => {
    const d = setup(); const author = createPersistenceController(d.port); author.start(world('player-controlled-name')); await author.client.save();
    const before = preserved(d.c); await d.c.client.exportSave();
    expect(d.files).toHaveLength(1); expect(d.files[0]!.text).toBe(d.texts.get('manual-1'));
    expect(d.files[0]!.filename).toBe('aftermath-manual-1-v1-r0.json'); expect(d.writes()).toBe(1);
    expect(preserved(d.c)).toEqual(before); expect(d.c.client.read().export).toMatchObject({ phase: 'initiated', slotId: 'manual-1' });
    expect(d.c.client.read().export.message).toContain('已发起下载'); expect(d.c.client.read().export.message).toContain('浏览器确认');
    expect(JSON.stringify(d.c.client.read())).not.toContain('player-controlled-name');
  });
  it('exports selected saved slot, never unsaved active memory or fixed automatic target', async () => {
    const d = setup(), s = d.c.start(world()).session; await d.c.client.save(); await d.c.client.enableAutosave();
    const other = createPersistenceController(d.port); other.start(world('other')); other.client.select('manual-2'); await other.client.save();
    d.c.client.select('manual-2'); await d.c.client.refresh(); s.setDraft('保留输入'); const view = s.read(), before = preserved(d.c), count = d.writes();
    expect(before.message).toContain('存档槽 2'); expect(before.message).toContain('存档槽 1'); expect(before.message).not.toContain('未手动保存');
    await d.c.client.exportSave(); expect(d.files[0]!.text).toBe(d.texts.get('manual-2')); expect(d.writes()).toBe(count);
    expect(s.read()).toEqual(view); expect(preserved(d.c)).toEqual(before);
    d.c.client.disableAutosave(); await s.observe(); const dirty = s.read(); d.c.client.select('manual-1'); await d.c.client.exportSave();
    expect(JSON.parse(d.files[1]!.text).worldRevision).toBe(0); expect(s.read()).toEqual(dirty); expect(d.writes()).toBe(count);
  });
  it.each(['{broken', '{"format":"aftermath-save","schemaVersion":999}', '\uFEFFraw <script>not executed</script>'])('preserves classified original text without DOM/view exposure', async text => {
    const d = setup(); d.port.exportCurrent = async id => ({ ok: true, value: { slotId: id, token: 'raw-token', text, kind: 'original' } });
    await d.c.client.exportSave(); expect(d.files).toEqual([{ text, filename: 'aftermath-manual-1-original.json' }]);
    expect(d.c.client.read().export.message).toContain('当前版本无法载入'); expect(JSON.stringify(d.c.client.read())).not.toContain(text); expect(d.writes()).toBe(0);
  });
  it('exporting an external newer snapshot does not adopt token or let an old branch overwrite', async () => {
    const d = setup(), s = d.c.start(world()).session; await d.c.client.save();
    const other = createPersistenceController(d.port), rival = (await other.client.load())!.session; await rival.observe(); await other.client.save();
    await s.observe(); await s.observe(); const before = preserved(d.c); await d.c.client.exportSave();
    expect(JSON.parse(d.files[0]!.text).worldRevision).toBe(1); expect(preserved(d.c)).toEqual(before);
    await d.c.client.save(); expect(d.c.client.read().phase).toBe('error'); expect(d.writes()).toBe(2);
  });
  it.each(['empty', 'missing_snapshot', 'invalid_format', 'non_text', 'invalid_utf8', 'unavailable', 'timeout', 'cancelled'])('reports %s without a file or changes to saving state', async code => {
    const d = setup(); d.port.exportCurrent = async () => ({ ok: false, code }); const before = preserved(d.c);
    await d.c.client.exportSave(); expect(d.c.client.read().export.phase).toBe('error'); expect(d.files).toHaveLength(0);
    expect(d.c.client.read().export.message).toContain('未发起下载'); expect(preserved(d.c)).toEqual(before); expect(d.writes()).toBe(0);
  });
  it.each(['throw', 'reject'])('download prepare %s retains world/draft/badge/mode and permits explicit retry', async fault => {
    const d = setup(), s = d.c.start(world()).session; await d.c.client.save(); await d.c.client.enableAutosave(); s.setDraft('草稿'); const prior = preserved(d.c), bridge = d.download.prepare;
    d.download.prepare = () => { if (fault === 'throw') throw Error('download failed'); return Promise.reject(Error('download failed')); };
    await d.c.client.exportSave(); expect(d.c.client.read().export.phase).toBe('error'); expect(d.files).toHaveLength(0); expect(preserved(d.c)).toEqual(prior); expect(s.read().draft).toBe('草稿');
    d.download.prepare = bridge; await d.c.client.exportSave(); expect(d.files).toHaveLength(1); expect(d.writes()).toBe(1);
  });
  it('locks repeated/conflicting operations while preparing but keeps draft editable', async () => {
    const d = setup(), s = d.c.start(world()).session; await d.c.client.save(); let resolve!: (p: PreparedDownload) => void;
    d.download.prepare = () => new Promise(r => resolve = r); const pending = d.c.client.exportSave(); await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    await d.c.client.exportSave(); await d.c.client.save(); await d.c.client.load(); await d.c.client.refresh(); await s.observe(); d.c.client.select('manual-2');
    expect(() => d.c.start(world('new'))).toThrow(); s.setDraft('可编辑'); expect(d.c.client.read().selectedSlot).toBe('manual-1'); expect(d.reads()).toBe(1);
    const lease = { start: vi.fn(), dispose: vi.fn() }; resolve(lease); await pending; expect(lease.start).toHaveBeenCalledTimes(1); expect(lease.dispose).toHaveBeenCalledTimes(1); expect(s.read().draft).toBe('可编辑'); expect(d.writes()).toBe(1);
  });
  it('late read after timeout does not prepare/download into a new world or target', async () => {
    const d = setup(20), s = d.c.start(world()).session; await d.c.client.save(); vi.useFakeTimers(); let resolve!: (x: SaveResult<ExportSnapshot>) => void;
    const snapshot = await d.port.exportCurrent!('manual-1'); d.port.exportCurrent = () => new Promise(r => resolve = r);
    const pending = d.c.client.exportSave(); await vi.advanceTimersByTimeAsync(21); await pending; expect(d.c.client.read().export.phase).toBe('error');
    d.c.client.select('manual-3'); d.c.start(world('new')); const before = d.c.client.read(); resolve(snapshot); await vi.advanceTimersByTimeAsync(1);
    expect(d.files).toHaveLength(0); expect(d.download.prepare).not.toHaveBeenCalled(); expect(d.c.client.read()).toEqual(before); expect(s.read().clock.worldRevision).toBe(0);
  });
  it('late prepared lease is disposed without starting or unlocking a newer export', async () => {
    const d = setup(20); d.c.start(world()); await d.c.client.save(); vi.useFakeTimers(); const resolvers: ((p: PreparedDownload) => void)[] = [];
    d.download.prepare = () => new Promise(r => resolvers.push(r)); const first = d.c.client.exportSave(); await vi.advanceTimersByTimeAsync(21); await first;
    const second = d.c.client.exportSave(); await vi.advanceTimersByTimeAsync(1); const late = { start: vi.fn(), dispose: vi.fn() }; resolvers[0]!(late); await vi.advanceTimersByTimeAsync(1);
    expect(late.start).not.toHaveBeenCalled(); expect(late.dispose).toHaveBeenCalledTimes(1); expect(d.c.client.read().busy).toBe(true);
    const current = { start: vi.fn(), dispose: vi.fn() }; resolvers[1]!(current); await second; expect(current.start).toHaveBeenCalledTimes(1); expect(d.c.client.read().export.phase).toBe('initiated');
  });
});
