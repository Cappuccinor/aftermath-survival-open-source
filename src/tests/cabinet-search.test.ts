import { expect, test, vi, afterEach } from 'vitest';
import { createEngine } from '../core/engine';
import { visibleSearchTargets } from '../core/search';
import { visibleInspectionTargets } from '../core/inspection';
import { visiblePickupTargets } from '../core/pickup';
import { createCabinetPrototype } from '../core/cabinet-prototype';
import * as candidates from '../core/cabinet-search';
import { action, clone, room, corridor, tin, cabinet, water, entries } from './cabinet-fixtures';
afterEach(() => vi.restoreAllMocks());
test.each(entries)('%s discovers an existing bottle once without acquiring or changing it', (_, factory) => {
  const w = factory(), e = createEngine(w), actor = w.player.playerId;
  expect(w.items[water]).toMatchObject({ count: 1, position: { kind: 'container', id: cabinet } });
  expect(w.knowledge.some(k => JSON.stringify(k).includes(water))).toBe(false);
  expect(visibleSearchTargets(w)).toEqual([{ targetId: room, label: '房间' }, { targetId: cabinet, label: '柜子' }]);
  for (let n = 0; n < 2; n++) {
    const result = e.dispatch(action('search', n, cabinet, actor));
    expect(result).toMatchObject({ ok: true, replayed: false, receipt: { rule: 'cabinet-search-v1', discoveredItemId: n ? null : water, observedAt: n + 1 } });
    expect(e.snapshot().items).toEqual(w.items); expect(e.snapshot().rngState).toEqual(w.rngState);
    expect(e.snapshot().player.stats).toEqual(w.player.stats);
    expect(visibleInspectionTargets(e.snapshot())).toEqual([]); expect(visiblePickupTargets(e.snapshot())).toEqual([]);
    expect(e.snapshot().knowledge.find(k => k.factId === `cabinet-discovery-${water}`)).toMatchObject({ source: 'evt-mixed-0-cabinet-discovery', observedAt: 1 });
  }
  expect(e.snapshot().eventJournal.slice(w.eventJournal.length).map(e => e.type)).toEqual(['TimeAdvanced', 'CabinetSearchRecorded', 'CabinetContentDiscovered', 'TimeAdvanced', 'CabinetSearchRecorded']);
  expect(e.snapshot().locations[room]!.searched).toBe(false);
});
test.each(['unknown', 'water', 'remote', 'dead', 'dark', 'arguments', 'tools', 'stale'])('rejects %s atomically', mode => {
  const w: any = clone(createCabinetPrototype());
  if (mode === 'dead') w.player.stats.hp = 0;
  if (mode === 'dark') w.locations[room].light = .49;
  const e = createEngine(w);
  if (mode === 'remote') expect(e.dispatch(action('move', 0, corridor)).ok).toBe(true);
  const command: any = action('search', e.snapshot().campaign.worldRevision, mode === 'unknown' ? 'unknown' : mode === 'water' ? water : cabinet);
  if (mode === 'stale') command.expectedWorldRevision = 7;
  if (mode === 'tools') command.toolIds = [tin];
  if (mode === 'arguments') command.arguments = { force: true };
  const before = e.snapshot(), result = e.dispatch(command);
  expect(result.ok).toBe(false); expect(e.snapshot()).toBe(before);
  expect(JSON.stringify(result)).not.toMatch(/water|瓶|metadata|count/);
  if (['remote', 'dead', 'dark'].includes(mode)) expect(visibleSearchTargets(before)).not.toContainEqual({ targetId: cabinet, label: '柜子' });
});
test('same ID cannot confuse cabinet and room searches, verbs or parameters', () => {
  for (const target of [cabinet, room]) {
    const e = createEngine(createCabinetPrototype()), c = action('search', 0, target);
    expect(e.dispatch(c).ok).toBe(true); const before = e.snapshot();
    for (const changed of [{ ...c, targetIds: [target === cabinet ? room : cabinet] }, { ...c, verb: 'inspect' }, { ...c, arguments: { force: true } }]) {
      expect(e.dispatch(changed).ok).toBe(false); expect(e.snapshot()).toBe(before);
    }
    expect(e.dispatch(c)).toMatchObject({ ok: true, replayed: true });
  }
});
test.each(entries)('%s keeps all 24 mixed actions deterministic after every JSON rebuild and old-ID retry', (_, factory) => {
  let e = createEngine(factory()); const other = createEngine(factory()); const commands: ReturnType<typeof action>[] = [], receipts: unknown[] = [];
  const sequence: [string, string?][] = [ ['search', cabinet], ['search', room], ['pick_up', tin], ['observe', 'prototype-door-gap'], ['move', corridor], ['observe'], ['move', room], ['search', cabinet] ];
  for (let n = 0; n < 24; n++) {
    const [verb, target] = n < 8 ? sequence[n]! : n % 4 === 0 ? ['move', corridor] : n % 4 === 1 ? ['observe'] : n % 4 === 2 ? ['move', room] : ['search', n % 8 === 3 ? room : cabinet];
    const c = action(verb!, n, target, e.snapshot().player.playerId); commands.push(c);
    const r = e.dispatch(c); expect(r.ok).toBe(true); expect(r).toEqual(other.dispatch(c)); if (!r.ok) throw Error('action failed'); receipts.push(r.receipt);
    const before = e.snapshot(); e = createEngine(clone(before)); expect(e.snapshot()).toEqual(before);
    const restored = e.snapshot(); commands.forEach((prior, i) => { expect(e.dispatch(prior)).toMatchObject({ ok: true, replayed: true, receipt: receipts[i] }); expect(e.snapshot()).toBe(restored); });
    expect(restored.items[water]!.position).toEqual({ kind: 'container', id: cabinet }); expect(restored.items[water]!.count).toBe(1);
    expect(restored.knowledge.find(k => k.factId === `cabinet-discovery-${water}`)?.observedAt).toBe(1);
  }
});
test.each(['time', 'revision', 'invalid'])('invalid %s candidate rolls back and does not reserve command ID', mode => {
  const original = candidates.createCabinetCandidate;
  const hook = vi.spyOn(candidates, 'createCabinetCandidate').mockImplementation((w, c) => {
    const x: any = clone(original(w, c));
    if (mode === 'time') x.campaign.gameClockMinutes = Number.MAX_SAFE_INTEGER;
    if (mode === 'revision') x.campaign.worldRevision = Number.MAX_SAFE_INTEGER + 1;
    if (mode === 'invalid') x.items[water].count = 2;
    return x;
  });
  const e = createEngine(createCabinetPrototype()), before = e.snapshot(), c = action('search', 0, cabinet);
  expect(e.dispatch(c)).toEqual({ ok: false, code: 'settlement_failed' }); expect(e.snapshot()).toBe(before);
  hook.mockRestore(); expect(e.dispatch(c)).toMatchObject({ ok: true, replayed: false });
});
test.each(['time', 'cabinet-search', 'cabinet-discovery'])('event ID %s collision preserves complete state', suffix => {
  const w: any = clone(createCabinetPrototype());
  w.eventJournal.push({ ...w.eventJournal.at(-1), type: 'Reserved', payload: {}, eventId: `evt-mixed-0-${suffix}`, seq: w.eventJournal.length + 1 });
  const e = createEngine(w), before = e.snapshot();
  expect(e.dispatch(action('search', 0, cabinet))).toEqual({ ok: false, code: 'settlement_failed' }); expect(e.snapshot()).toBe(before);
});
