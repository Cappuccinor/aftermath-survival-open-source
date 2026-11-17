import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPersistenceController } from '../application/persistence';
import { createLifecyclePrototype } from '../core/npc-lifecycle-prototype';
import { createEngine } from '../core/engine';
import { readActionReceipts } from '../core/receipts';
import { decodeSave, encodeSave } from '../adapters/storage/save-format';
import type { ManualSaveStore, SlotContents, SaveResult } from '../adapters/storage/port';
import type { ManualSlotId } from '../application/ports';
import type { NarrationOptions } from '../application/narration';

const empty = (): SlotContents => ({ token: null, document: null, previous: null });
const world = (id = 'auto-world') => {
  const w = createLifecyclePrototype(1);
  return createEngine({ ...w, campaign: { ...w.campaign, saveId: id } }).snapshot();
};
function disk() {
  const slots = new Map<ManualSlotId, SlotContents>();
  const writes: { slot: ManualSlotId; revision: number }[] = [];
  let error: string | undefined;
  const port: ManualSaveStore = {
    read: async id => ({ ok: true, value: slots.get(id) ?? empty() }),
    write: async (w, req) => {
      writes.push({ slot: req.slotId, revision: w.campaign.worldRevision });
      if (error) return { ok: false, code: error };
      const old = slots.get(req.slotId) ?? empty();
      if (old.token !== req.expectedToken) return { ok: false, code: 'conflict' };
      if (req.signal?.aborted) return { ok: false, code: 'cancelled' };
      const slot = { token: `t-${writes.length}`, previous: old.document,
        document: await decodeSave(await encodeSave(w, { gameBuild: 'test', savedAtUtc: '2026-10-25T00:00:00.000Z' })) };
      slots.set(req.slotId, slot); return { ok: true, value: slot };
    },
  };
  return { port, slots, writes, fail: (code?: string) => { error = code; } };
}
async function enabled(options: NarrationOptions & { timeoutMs?: number } = {}) {
  const d = disk(), c = createPersistenceController(d.port, options), s = c.start(world()).session;
  await c.client.save(); await c.client.enableAutosave();
  return { d, c, s };
}
afterEach(() => vi.useRealTimers());
describe('explicit session-bound automatic persistence', () => {
  it('defaults off, rejects unbound or dirty enable, and enabling does not write', async () => {
    const d = disk(), c = createPersistenceController(d.port), s = c.start(world()).session;
    expect(c.client.read().autosave.mode).toBe('off');
    await c.client.enableAutosave(); expect(d.writes).toHaveLength(0);
    expect(c.client.read().message).toContain('先手动保存');
    await c.client.save(); await s.observe(); await c.client.enableAutosave();
    expect(d.writes).toHaveLength(1); expect(c.client.read().autosave.mode).toBe('off');
    await c.client.save(); const prior = d.slots.get('manual-1'); await c.client.enableAutosave();
    expect(d.writes).toHaveLength(2); expect(d.slots.get('manual-1')).toBe(prior);
    expect(c.client.read().autosave).toMatchObject({ mode: 'on', slotId: 'manual-1' });
  });
  it('checks actual token when enabling and never adopts an external replacement', async () => {
    const { d, c } = await enabled(); c.client.disableAutosave();
    const external = createPersistenceController(d.port); const s = (await external.client.load())!.session;
    await s.observe(); await external.client.save(); const count = d.writes.length;
    await c.client.enableAutosave(); expect(c.client.read().autosave.mode).not.toBe('on');
    expect(c.client.read().message).toContain('主动读取'); expect(c.client.read().message).toContain('刷新列表不会解除冲突');
    expect(d.writes).toHaveLength(count); await c.client.refresh(); await c.client.enableAutosave();
    expect(c.client.read().autosave.mode).not.toBe('on');
  });
  it('writes once per presented revision; draft, reject, retry, refresh, select and switches do not write', async () => {
    const { d, c, s } = await enabled();
    s.setDraft('我想飞向月球'); await s.submitText(); await s.retry(); await c.client.refresh();
    c.client.select('manual-2'); c.client.select('manual-1'); c.client.disableAutosave(); await c.client.enableAutosave();
    expect(d.writes).toHaveLength(1);
    await s.observe(); await s.retry(); s.setDraft('只是输入');
    expect(d.writes).toEqual([{ slot: 'manual-1', revision: 0 }, { slot: 'manual-1', revision: 1 }]);
    expect(c.client.read().savedToSelected).toBe(true); expect(s.read().draft).toBe('只是输入');
    c.client.disableAutosave(); await s.observe(); expect(d.writes).toHaveLength(2);
    expect(c.client.read().savedToSelected).toBe(false);
  });
  it('keeps automatic target fixed while manual selection and other slots remain independent', async () => {
    const { d, c, s } = await enabled();
    const other = createPersistenceController(d.port); other.start(world('other')); other.client.select('manual-3'); await other.client.save();
    const before = d.slots.get('manual-3'); c.client.select('manual-2'); await s.observe();
    expect(d.slots.has('manual-2')).toBe(false); expect(d.slots.get('manual-3')).toBe(before);
    expect(d.slots.get('manual-1')!.document!.worldRevision).toBe(1);
    expect(c.client.read()).toMatchObject({ selectedSlot: 'manual-2', savedToSelected: false, autosave: { mode: 'on', slotId: 'manual-1' } });
    await c.client.save(); expect(c.client.read().autosave.mode).toBe('off');
    await s.observe(); expect(d.slots.get('manual-2')!.document!.worldRevision).toBe(1);
    await c.client.save(); await c.client.enableAutosave(); await s.observe();
    expect(d.slots.get('manual-2')!.document!.worldRevision).toBe(3);
    expect(d.slots.get('manual-1')!.document!.worldRevision).toBe(1);
  });
  it('keeps same-slot mode on, but load/new world reset it and old sessions cannot act', async () => {
    const { d, c, s } = await enabled(); await c.client.save(); expect(c.client.read().autosave.mode).toBe('on');
    const loaded = (await c.client.load())!.session; expect(c.client.read().autosave.mode).toBe('off');
    await c.client.enableAutosave(); await s.observe(); expect(d.writes).toHaveLength(2);
    const fresh = c.start(world('new')).session; expect(c.client.read().autosave.mode).toBe('off');
    await loaded.observe(); await fresh.observe(); expect(d.writes).toHaveLength(2);
  });
  it('cancelled or failed load/overwrite keeps mode, world and draft', async () => {
    const { d, c, s } = await enabled(); const other = createPersistenceController(d.port); other.start(world('other')); other.client.select('manual-2'); await other.client.save();
    c.client.select('manual-2'); s.setDraft('保留草稿'); const before = s.read();
    await c.client.load(); c.client.cancel(); expect(s.read()).toEqual(before); expect(c.client.read().autosave.mode).toBe('on');
    await c.client.save(); c.client.cancel(); expect(c.client.read().autosave.slotId).toBe('manual-1');
    await c.client.save(); d.fail('quota_exceeded'); await c.client.confirm();
    expect(c.client.read().autosave.mode).toBe('on'); expect(s.read()).toEqual(before);
    d.port.read = async () => ({ ok: false, code: 'invalid_format' }); await c.client.load();
    expect(c.client.read().autosave.mode).toBe('on');
  });
  it.each(['quota_exceeded', 'cancelled', 'storage_error', 'timeout'])('pauses on %s, retains fact/disk/draft, and only explicit recovery writes again', async code => {
    const { d, c, s } = await enabled(); const prior = d.slots.get('manual-1');
    d.fail(code); s.setDraft('保存时也保留'); await s.observe();
    expect(s.read().clock.worldRevision).toBe(1); expect(s.read().draft).toBe('保存时也保留');
    expect(d.slots.get('manual-1')).toBe(prior); expect(c.client.read().autosave.mode).toBe('paused');
    expect(c.client.read().autosave.message).toContain('手动保存'); expect(c.client.read().savedToSelected).toBe(false);
    await s.observe(); await c.client.refresh(); expect(d.writes).toHaveLength(2);
    d.fail(); await c.client.save(); expect(c.client.read().autosave.mode).toBe('paused');
    await c.client.enableAutosave(); await s.observe(); expect(d.writes).toHaveLength(4);
    expect(d.slots.get('manual-1')!.document!.worldRevision).toBe(3);
  });
  it('stale higher-revision branch cannot refresh/reselect out of conflict; active load is confirmed', async () => {
    const { d, c: a, s: sa } = await enabled(); const b = createPersistenceController(d.port), sb = (await b.client.load())!.session;
    await sb.observe(); await sb.observe(); await b.client.save(); await b.client.enableAutosave();
    await sa.observe(); expect(a.client.read().autosave.mode).toBe('paused');
    const preserved = d.slots.get('manual-1'); await sa.observe(); await sa.observe();
    a.client.select('manual-2'); a.client.select('manual-1'); await a.client.refresh(); await a.client.save();
    expect(d.slots.get('manual-1')).toBe(preserved); expect(a.client.read().message).toContain('刷新列表不会解除冲突');
    sa.setDraft('会被丢弃前先确认'); await a.client.load(); expect(a.client.read().confirmation).toBe('load');
    a.client.cancel(); expect(sa.read().draft).toBe('会被丢弃前先确认');
    await a.client.load(); const restored = (await a.client.confirm())!.session; expect(a.client.read().autosave.mode).toBe('off');
    await a.client.enableAutosave(); await restored.observe(); expect(d.slots.get('manual-1')!.document!.worldRevision).toBe(3);
  });
  it('locks conflicting operations during auto write, keeps draft editable, and counts one write', async () => {
    const { d, c, s } = await enabled(); const original = d.port.write;
    let resume!: () => void; let entered!: () => void; const writing = new Promise<void>(r => entered = r);
    d.port.write = async (w, r) => { entered(); await new Promise<void>(r => resume = r); return original(w, r); };
    const action = s.observe(); await writing; expect(c.client.read().autosave.mode).toBe('saving');
    c.client.select('manual-2'); c.client.disableAutosave(); await c.client.enableAutosave(); await c.client.save(); await c.client.load(); await c.client.refresh(); await s.observe();
    expect(() => c.start(world('new'))).toThrow(); s.setDraft('仍可编辑'); expect(c.client.read().selectedSlot).toBe('manual-1');
    resume(); await action; expect(d.writes).toHaveLength(2); expect(s.read().draft).toBe('仍可编辑');
    expect(c.client.read().autosave.mode).toBe('on');
  });
  it.each(['success', 'failure'])('ignores late %s after timeout and a new world', async result => {
    const { d, c, s } = await enabled({ timeoutMs: 30 }); vi.useFakeTimers();
    let finish!: (value: SaveResult<SlotContents>) => void, signal: AbortSignal | undefined;
    d.port.write = (_w, r) => { signal = r.signal; return new Promise(resolve => finish = resolve); };
    const action = s.observe(); await vi.advanceTimersByTimeAsync(31); await action;
    expect(signal!.aborted).toBe(true); expect(c.client.read().autosave.mode).toBe('paused');
    c.client.select('manual-3'); const fresh = c.start(world('new')).session; fresh.setDraft('新草稿'); const before = c.client.read();
    finish(result === 'success' ? { ok: true, value: empty() } : { ok: false, code: 'storage_error' });
    await vi.advanceTimersByTimeAsync(1); expect(c.client.read()).toEqual(before); expect(fresh.read().draft).toBe('新草稿');
  });
  it.each(['reject', 'cancelled', 'timeout'])('saves committed facts after narrator %s fallback, ignores late output', async kind => {
    let late!: (value: unknown) => void;
    const narrator: NonNullable<NarrationOptions['narrator']> = { narrate: async () => {
      if (kind === 'reject') throw Error('provider failed');
      if (kind === 'cancelled') return { ok: false, code: 'cancelled' };
      return new Promise(resolve => { late = resolve as typeof late; });
    } };
    const { d, c, s } = await enabled({ narrator, narrationTimeoutMs: 10 });
    await s.observe(); expect(s.read().phase).toBe('success'); expect(d.writes).toHaveLength(2);
    expect(d.slots.get('manual-1')!.document!.worldRevision).toBe(1);
    c.start(world('next')); late?.({ ok: true, value: '不可信迟到叙事' }); await Promise.resolve();
    expect(c.client.read().autosave.mode).toBe('off'); expect(d.writes).toHaveLength(2);
  });
  it('persists whole world, deduplicates original receipt and resumes identical RNG after restoration', async () => {
    const { d, c, s } = await enabled(); await s.search(s.read().searchTargets.find(t => t.label.includes('柜'))!.targetId);
    await s.pickUp(s.read().pickupTargets.find(t => t.targetId.includes('water'))!.targetId);
    const saved = d.slots.get('manual-1')!.document!.worldState, engine = createEngine(saved);
    for (const receipt of readActionReceipts(saved)) {
      if (receipt.rule !== 'cabinet-search-v2' && receipt.rule !== 'pick_up-v2') throw Error('Unexpected test receipt');
      const retry = engine.dispatch({ commandId: receipt.commandId, actorId: receipt.request.actorId, source: 'button',
        verb: receipt.rule === 'pick_up-v2' ? 'pick_up' : 'search', targetIds: [receipt.rule === 'pick_up-v2' ? receipt.request.itemId : receipt.request.cabinetId],
        toolIds: [], arguments: {}, utterance: '', expectedWorldRevision: receipt.request.expectedWorldRevision }); expect(retry.ok).toBe(true);
      if (retry.ok) expect(retry.replayed).toBe(true);
      expect(engine.snapshot()).toEqual(saved);
    }
    const next = createPersistenceController(d.port), loaded = (await next.client.load())!.session;
    expect(loaded.read().inventory).toEqual(s.read().inventory); expect(loaded.read().clock).toEqual(s.read().clock);
    expect(next.client.read().autosave.mode).toBe('off');
    await next.client.enableAutosave(); await loaded.observeDoorGap(loaded.read().doorTargets[0]!.targetId);
    const after = d.slots.get('manual-1')!.document!.worldState;
    const receipt = readActionReceipts(after).at(-1)!;
    expect(engine.dispatch({ commandId: receipt.commandId, actorId: saved.player.playerId, source: 'button', verb: 'observe',
      targetIds: [loaded.read().doorTargets[0]!.targetId], toolIds: [], arguments: { through: 'door_gap', careful: true }, utterance: '', expectedWorldRevision: saved.campaign.worldRevision }).ok).toBe(true);
    expect(engine.snapshot()).toEqual(after);
    expect(c.client.read().autosave.mode).toBe('on');
  });
});
