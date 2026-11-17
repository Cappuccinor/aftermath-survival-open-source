import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPersistenceController } from '../application/persistence';
import { createLifecyclePrototype } from '../core/npc-lifecycle-prototype';
import { createEngine } from '../core/engine';
import { decodeSave, encodeSave } from '../adapters/storage/save-format';
import type { ManualSaveStore, SlotContents } from '../adapters/storage/port';

const world = (id = 'world-a', seed = 1) => { const w = createLifecyclePrototype(seed); return createEngine({ ...w, campaign: { ...w.campaign, saveId: id } }).snapshot(); };
function storage() {
  let slot: SlotContents = { token: null, document: null, previous: null }, calls = 0;
  const port: ManualSaveStore = {
    read: async () => ({ ok: true, value: slot }),
    write: async (w, request) => {
      calls++;
      if (request.expectedToken !== slot.token) return { ok: false, code: 'conflict' };
      if (request.signal?.aborted) return { ok: false, code: 'cancelled' };
      slot = { token: `token-${calls}`, document: await decodeSave(await encodeSave(w, { gameBuild: 'test', savedAtUtc: '2026-10-24T00:00:00.000Z' })), previous: slot.document };
      return { ok: true, value: slot };
    },
  };
  return { port, slot: () => slot, calls: () => calls };
}
afterEach(() => vi.useRealTimers());
describe('G2 trusted manual persistence and session replacement', () => {
  it('rejects a stale loaded branch with a higher revision even after refreshing slot metadata', async () => {
    const disk = storage(), seed = createPersistenceController(disk.port); seed.start(world()); await seed.client.save();
    const a = createPersistenceController(disk.port), b = createPersistenceController(disk.port);
    const sa = (await a.client.load())!.session, sb = (await b.client.load())!.session;
    await sa.search('prototype-location'); await sa.pickUp(sa.read().pickupTargets[0]!.targetId); await a.client.save();
    const preserved = disk.slot(); expect(preserved.document!.worldState.player.stats.carryWeightKg).toBe(.05);
    await sb.observe(); await sb.observe(); await sb.observe(); expect(sb.read().clock.worldRevision).toBe(3);
    await b.client.save(); expect(b.client.read().phase).toBe('error'); expect(disk.slot()).toEqual(preserved);
    await b.client.refresh(); await b.client.save(); expect(b.client.read().phase).toBe('error'); expect(disk.slot()).toEqual(preserved);
    await b.client.load(); const recovered = await b.client.confirm(); expect(recovered!.session.read().inventory).toHaveLength(1);
  });
  it('saves the full current world and marks later successful actions dirty', async () => {
    const disk = storage(), c = createPersistenceController(disk.port), started = c.start(world());
    await started.session.search('prototype-location');
    expect(c.client.read().phase).toBe('idle');
    await c.client.save();
    expect(c.client.read().phase).toBe('saved');
    expect(disk.slot().document?.worldRevision).toBe(1);
    expect(disk.slot().document?.worldState.npcs).toHaveLength(1);
    await started.session.observe();
    expect(c.client.read().phase).toBe('idle');
    expect(disk.slot().document?.worldRevision).toBe(1);
  });
  it('loads exact world, visible history and targets without an action, then uses fresh command IDs', async () => {
    const disk = storage(), c = createPersistenceController(disk.port), old = c.start(world());
    await old.session.observe(); await old.session.search('prototype-location'); await c.client.save();
    const prior = old.session.read(), saved = disk.slot().document!.worldState;
    const next = createPersistenceController(disk.port); const restored = await next.client.load();
    expect(restored).not.toBeNull();
    expect(restored!.session.read()).toMatchObject({ clock: prior.clock, entries: prior.entries, pickupTargets: prior.pickupTargets });
    expect(disk.slot().document!.worldState).toEqual(saved);
    await restored!.session.observe(); await next.client.save();
    expect(disk.slot().document!.worldRevision).toBe(3);
    expect(new Set(disk.slot().document!.eventJournal.map(e => e.eventId)).size).toBe(disk.slot().document!.eventJournal.length);
  });
  it('continues door RNG exactly as the uninterrupted saved branch', async () => {
    const disk = storage(), c = createPersistenceController(disk.port), first = c.start(world());
    const door = first.session.read().doorTargets[0]!.targetId;
    await first.session.observeDoorGap(door); await c.client.save();
    const saved = disk.slot().document!.worldState;
    const load = createPersistenceController(disk.port), second = await load.client.load();
    await second!.session.observeDoorGap(door); await load.client.save();
    const after = disk.slot().document!.worldState;
    // Use the actual new ID on the untouched branch to compare every fact, not just visible text.
    const events = after.eventJournal.slice(saved.eventJournal.length);
    const receipt = events.find(e => 'commandId' in e.payload)?.payload as { commandId: string };
    const expected = createEngine(saved); expected.dispatch({ commandId: receipt.commandId, actorId: saved.player.playerId, source: 'button', verb: 'observe', targetIds: [door], toolIds: [], arguments: { through: 'door_gap', careful: true }, utterance: '', expectedWorldRevision: saved.campaign.worldRevision });
    expect(after).toEqual(expected.snapshot());
  });
  it('requires discard confirmation, cancel preserves unsaved world and editable draft', async () => {
    const disk = storage(), c = createPersistenceController(disk.port), s = c.start(world()).session;
    await c.client.save(); await s.observe(); s.setDraft('还没决定'); const before = s.read();
    expect(await c.client.load()).toBeNull(); expect(c.client.read().confirmation).toBe('load');
    await s.observe(); expect(s.read().clock).toEqual(before.clock); s.setDraft('等待时仍可编辑');
    c.client.cancel(); expect(s.read().draft).toBe('等待时仍可编辑'); expect(s.read().clock).toEqual(before.clock);
    await s.observe(); expect(s.read().clock.worldRevision).toBe(2);
  });
  it('confirmation loads saved state and disables the obsolete session capability', async () => {
    const disk = storage(), c = createPersistenceController(disk.port), old = c.start(world()).session;
    await c.client.save(); await old.observe(); await c.client.load(); const restored = await c.client.confirm();
    expect(restored!.session.read().clock.worldRevision).toBe(0);
    await old.observe(); await c.client.save(); expect(disk.slot().document!.worldRevision).toBe(0);
  });
  it('does not overwrite another world until explicit confirmation and binds it to the read token', async () => {
    const disk = storage(), c = createPersistenceController(disk.port); c.start(world()); await c.client.save();
    c.start(world('world-b')); await c.client.save(); expect(c.client.read().confirmation).toBe('save');
    c.client.cancel(); expect(disk.slot().document!.saveId).toBe('world-a');
    await c.client.save();
    await disk.port.write(world('world-c'), { slotId: 'manual-1', expectedToken: disk.slot().token, allowReplaceWorld: true });
    await c.client.confirm(); expect(c.client.read().phase).toBe('error'); expect(disk.slot().document!.saveId).toBe('world-c');
    await c.client.save(); await c.client.confirm(); expect(disk.slot().document!.saveId).toBe('world-b');
  });
  it('read failure preserves current world and draft and permits retry/continued action', async () => {
    const disk = storage(), c = createPersistenceController(disk.port), s = c.start(world()).session;
    s.setDraft('保留'); const before = s.read(); const read = disk.port.read;
    disk.port.read = async () => ({ ok: false, code: 'checksum_mismatch' });
    expect(await c.client.load()).toBeNull(); expect(s.read()).toEqual(before); expect(c.client.read().phase).toBe('error');
    disk.port.read = read; await s.observe(); expect(s.read().clock.worldRevision).toBe(1);
  });
  it('invalid loaded Core state never replaces the active session', async () => {
    const disk = storage(), c = createPersistenceController(disk.port), s = c.start(world()).session; await c.client.save();
    const valid = disk.slot();
    disk.port.read = async () => ({ ok: true, value: { ...valid, document: { ...valid.document!, worldState: { ...valid.document!.worldState, player: { ...valid.document!.worldState.player, stats: { ...valid.document!.worldState.player.stats, hp: 101 } } } } } });
    s.setDraft('别丢'); await c.client.load(); await c.client.confirm(); expect(c.client.read().phase).toBe('error');
    expect(s.read().draft).toBe('别丢'); await s.observe(); expect(s.read().clock.worldRevision).toBe(1);
  });
  it('save failure does not roll back a committed action or erase the draft', async () => {
    const disk = storage(), c = createPersistenceController(disk.port), s = c.start(world()).session;
    await s.observe(); s.setDraft('下一步'); disk.port.write = async () => ({ ok: false, code: 'quota_exceeded' }); await c.client.save();
    expect(c.client.read().phase).toBe('error'); expect(s.read().clock.worldRevision).toBe(1); expect(s.read().draft).toBe('下一步');
    expect(c.client.read().canSave).toBe(true);
  });
  it('one pending operation blocks duplicates/actions but leaves draft editing and times out once', async () => {
    vi.useFakeTimers(); const disk = storage(); let signal: AbortSignal | undefined, calls = 0;
    disk.port.read = async (_slot, s) => { signal = s; calls++; return new Promise(() => {}); };
    const c = createPersistenceController(disk.port, { timeoutMs: 50 }), s = c.start(world()).session;
    const pending = c.client.save(); await c.client.save(); await c.client.load(); await s.observe(); s.setDraft('仍然能写');
    expect(calls).toBe(1); expect(s.read().clock.worldRevision).toBe(0); expect(s.read().draft).toBe('仍然能写');
    expect(() => c.start(world('other'))).toThrow();
    await vi.advanceTimersByTimeAsync(51); await pending;
    expect(signal!.aborted).toBe(true); expect(c.client.read().phase).toBe('error'); expect(c.client.read().busy).toBe(false);
  });
  it('a late result after timeout cannot mark a new world saved', async () => {
    vi.useFakeTimers(); const disk = storage(); let finish!: (x: Awaited<ReturnType<ManualSaveStore['read']>>) => void;
    disk.port.read = () => new Promise(resolve => { finish = resolve; });
    const c = createPersistenceController(disk.port, { timeoutMs: 20 }); c.start(world()); const pending = c.client.save();
    await vi.advanceTimersByTimeAsync(21); await pending; const newer = c.start(world('new-world'));
    finish({ ok: true, value: { token: null, document: null, previous: null } }); await Promise.resolve(); await Promise.resolve();
    expect(disk.calls()).toBe(0); expect(c.client.read().phase).toBe('idle'); expect(newer.session.read().clock.worldRevision).toBe(0);
  });
});
