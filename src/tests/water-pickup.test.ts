import { afterEach, expect, test, vi } from 'vitest';
import { createEngine } from '../core/engine';
import { createTransferPrototype } from '../core/transfer-prototype';
import * as transfers from '../core/transfer';
import { visiblePickupTargets } from '../core/pickup';
import { visibleInspectionTargets } from '../core/inspection';
import { action, clone, room, corridor, tin, water, cabinet, transferEntries, bothDiscovered } from './transfer-fixtures';
afterEach(() => vi.restoreAllMocks());
test.each(transferEntries)('%s preserves24 mixed steps in both pickup orders with all prior retries after each JSON rebuild', (_, factory) => {
  for (const order of [[water, tin], [tin, water]] as const) {
    let e = createEngine(factory()); const mirror = createEngine(factory()), commands: ReturnType<typeof action>[] = [], receipts: unknown[] = [];
    const initial = e.snapshot();
    const opening: [string, string?][] = [['search', room], ['search', cabinet], ['pick_up', order[0]], ['search', cabinet], ['pick_up', order[1]], ['observe', 'prototype-door-gap'], ['move', corridor], ['move', room]];
    for (let n = 0; n < 24; n++) {
      if (n === 2) expect(visiblePickupTargets(e.snapshot())).toEqual([{ targetId: tin, label: '空罐' }, { targetId: water, label: '瓶装水' }]);
      const [verb, target] = n < 8 ? opening[n]! : n % 4 === 0 ? ['search', cabinet] : n % 4 === 1 ? ['move', corridor] : n % 4 === 2 ? ['observe'] : ['move', room];
      const c = action(verb!, n, target, initial.player.playerId), r = e.dispatch(c); expect(r.ok, `${order} step${n}`).toBe(true);
      expect(r).toEqual(mirror.dispatch(c)); if (!r.ok) throw Error('action failed'); commands.push(c); receipts.push(r.receipt);
      if (n === 2) expect(e.snapshot().player.stats.carryWeightKg).toBe(order[0] === water ? .5 : .05);
      if (n >= 4) { expect(e.snapshot().player.stats.carryWeightKg).toBe(.55); expect(visiblePickupTargets(e.snapshot())).toEqual([]); }
      if (n === 2 || n === 4) {
        expect(r.receipt.rule).toBe('pick_up-v2'); expect(e.snapshot().rngState).toEqual(initial.rngState);
        expect({ ...e.snapshot().player.stats, carryWeightKg: 0 }).toEqual(initial.player.stats);
      }
      for (const id of [water, tin]) {
        expect({ ...e.snapshot().items[id]!, position: initial.items[id]!.position }).toEqual(initial.items[id]);
        expect(e.snapshot().items[id]!.count).toBe(1);
      }
      const before = e.snapshot(); e = createEngine(clone(before)); expect(e.snapshot()).toEqual(before);
      const restored = e.snapshot(); commands.forEach((old, i) => { expect(e.dispatch(old)).toMatchObject({ ok: true, replayed: true, receipt: receipts[i] }); expect(e.snapshot()).toBe(restored); });
      if (n >= 1) expect(restored.knowledge.find(k => k.factId === `cabinet-discovery-${water}`)).toMatchObject({ source: 'evt-mixed-1-cabinet-discovery', observedAt: 2 });
    }
    expect(e.snapshot().items[water]!.position).toEqual({ kind: 'player', id: initial.player.playerId });
    expect(e.snapshot().items[cabinet]).toEqual(initial.items[cabinet]);
  }
});
test('search receipts fix original water position; later ownership never rewrites earlier outcome', () => {
  const e = bothDiscovered(), before = action('search', 2, cabinet), first = e.dispatch(before);
  expect(first).toMatchObject({ ok: true, receipt: { rule: 'cabinet-search-v2', waterLocation: 'cabinet', discoveredItemId: null } });
  expect(e.dispatch(action('pick_up', 3, water))).toMatchObject({ ok: true, receipt: { rule: 'pick_up-v2', from: { kind: 'container', id: cabinet }, to: { kind: 'player', id: 'prototype-player' }, beforeCarryWeightKg: 0, afterCarryWeightKg: .5 } });
  expect(e.dispatch(action('search', 4, cabinet))).toMatchObject({ ok: true, receipt: { waterLocation: 'player', discoveredItemId: null } });
  expect(e.dispatch(before)).toMatchObject({ ok: true, replayed: true, receipt: { waterLocation: 'cabinet' } });
  expect(visibleInspectionTargets(e.snapshot())).toEqual([{ targetId: tin, label: '空罐' }]);
});
test.each(['undiscovered', 'unknown', 'cabinet', 'remote', 'dead', 'dark', 'already-owned', 'tools', 'arguments', 'stale'])('rejects %s atomically without secrets', mode => {
  const w: any = clone(mode === 'undiscovered' ? createTransferPrototype() : bothDiscovered().snapshot());
  // The created-character branch retains stronger initial-stat invariants; use prototype for rule preconditions.
  if (mode === 'dead') w.player.stats.hp = 0;
  if (mode === 'dark') {
    // Low light from initialization, then no discovery: a forged target must not bypass visibility.
    Object.assign(w, clone(createTransferPrototype())); w.locations[room].light = .49;
  }
  const e = createEngine(w), actor = w.player.playerId;
  if (mode === 'remote') expect(e.dispatch(action('move', 2, corridor, actor)).ok).toBe(true);
  if (mode === 'already-owned') expect(e.dispatch(action('pick_up', 2, water, actor)).ok).toBe(true);
  const c: any = action('pick_up', e.snapshot().campaign.worldRevision, mode === 'unknown' ? 'unknown' : mode === 'cabinet' ? cabinet : water, actor);
  if (mode === 'tools') c.toolIds = [tin]; if (mode === 'arguments') c.arguments = { force: true }; if (mode === 'stale') c.expectedWorldRevision = 99;
  const before = e.snapshot(), result = e.dispatch(c); expect(result.ok).toBe(false); expect(e.snapshot()).toBe(before);
  expect(JSON.stringify(result)).not.toMatch(/bottled|metadata|condition|瓶/);
});
test('same ID with other item/verb/revision/parameters conflicts; retry survives departure', () => {
  const e = bothDiscovered(), c = action('pick_up', 2, water); expect(e.dispatch(c).ok).toBe(true);
  expect(e.dispatch(action('move', 3, corridor)).ok).toBe(true); const before = e.snapshot();
  for (const change of [{ targetIds: [tin] }, { verb: 'search' }, { expectedWorldRevision: 4 }, { arguments: { force: true } }]) {
    expect(e.dispatch({ ...c, ...change }).ok).toBe(false); expect(e.snapshot()).toBe(before);
  }
  expect(e.dispatch(c)).toMatchObject({ ok: true, replayed: true }); expect(e.snapshot()).toBe(before);
});
test.each(['time', 'revision', 'badweight'])('candidate %s failure is atomic and does not consume ID', mode => {
  const original = transfers.createTransferCandidate, hook = vi.spyOn(transfers, 'createTransferCandidate').mockImplementation((w, c) => {
    const x: any = clone(original(w, c));
    if (mode === 'time') x.campaign.gameClockMinutes = Number.MAX_SAFE_INTEGER;
    if (mode === 'revision') x.campaign.worldRevision = Number.MAX_SAFE_INTEGER + 1;
    if (mode === 'badweight') x.player.stats.carryWeightKg = 2;
    return x;
  });
  const e = bothDiscovered(), before = e.snapshot(), c = action('pick_up', 2, water);
  expect(e.dispatch(c)).toEqual({ ok: false, code: 'settlement_failed' }); expect(e.snapshot()).toBe(before);
  hook.mockRestore(); expect(e.dispatch(c)).toMatchObject({ ok: true, replayed: false });
});
test.each(['time', 'transfer'])('colliding %s event rolls back', suffix => {
  const w: any = clone(bothDiscovered().snapshot()); w.eventJournal.push({ ...w.eventJournal.at(-1), seq: w.eventJournal.length + 1, type: 'Reserved', payload: {}, eventId: `evt-mixed-2-${suffix}` });
  const e = createEngine(w), before = e.snapshot(); expect(e.dispatch(action('pick_up', 2, water))).toEqual({ ok: false, code: 'settlement_failed' }); expect(e.snapshot()).toBe(before);
});
