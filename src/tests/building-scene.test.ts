import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { addBuildingScene, createBuildingGame, createBuildingPrototype } from '../core/building-prototype';
import { readBuildingScene } from '../core/building-scene';
import { createPickupGame, createPickupPrototype } from '../core/pickup-prototype';
import { createEngine } from '../core/engine';
import { parseWorldState } from '../core/world';
import { action, clone, room, corridor, tin } from './pickup-fixtures';
import { doorCharacter, doorMetadata } from './door-fixtures';

const init = (w: any) => w.eventJournal.find((e: any) => e.type === 'BuildingSceneInitialized');
const fact = (w: any) => w.knowledge.find((k: any) => k.factId === 'known-building-scene');
const renumber = (w: any) => w.eventJournal.forEach((e: any, n: number) => e.seq = n + 1);

test('new factories add exactly one initialization/known fact without altering any existing truth', () => {
  for (const [old, next] of [[createPickupPrototype(35), createBuildingPrototype(35)],
    [createPickupGame(doorCharacter, doorMetadata), createBuildingGame(doorCharacter, doorMetadata)]]) {
    const w: any = clone(next);
    expect(w.eventJournal).toHaveLength(old!.eventJournal.length + 1);
    expect(w.knowledge).toHaveLength(old!.knowledge.length + 1);
    expect(readBuildingScene(next!)).toMatchObject({ scene: 'abandoned-residential-building-v1', roomId: room, corridorId: corridor });
    w.eventJournal.pop(); w.knowledge.pop(); w.player.knownFactIds.pop();
    expect(w).toEqual(old); expect(parseWorldState(w)).toEqual(old);
    expect(readBuildingScene(old!)).toBeNull();
  }
});
const corruptions: [string, (w: any) => void][] = [
  ['rule', w => init(w).payload.rule = 'building-scene-v2'],
  ['scene type', w => init(w).payload.scene = '<script>枪</script>'],
  ['extra payload', w => init(w).payload.description = '无人且安全'],
  ['actor', w => init(w).actorId = null], ['payload actor', w => init(w).payload.playerId = 'other'],
  ['event id', w => init(w).eventId = 'other'], ['type', w => init(w).type = 'Other'],
  ['time', w => init(w).worldTimeMinutes = 1], ['visibility', w => init(w).visibility = 'public'],
  ['target', w => init(w).targetIds.reverse()], ['room', w => init(w).payload.roomId = corridor],
  ['corridor', w => init(w).payload.corridorId = room], ['source', w => init(w).payload.routeSourceEventId = 'other'],
  ['pickup source', w => init(w).payload.pickupSourceEventId = 'other'],
  ['duplicate', w => w.eventJournal.push({ ...clone(init(w)), eventId: 'duplicate' })],
  ['before pickup', w => { const e = w.eventJournal.pop(); w.eventJournal.splice(w.eventJournal.length - 1, 0, e); }],
  ['missing route', w => w.eventJournal = w.eventJournal.filter((e: any) => e.type !== 'KnownRouteInitialized')],
  ['route actor', w => w.eventJournal.find((e: any) => e.type === 'KnownRouteInitialized').actorId = null],
  ['route payload', w => w.eventJournal.find((e: any) => e.type === 'KnownRouteInitialized').payload.extra = true],
  ['missing adjacency', w => w.locations[room].adjacentLocationIds = []],
  ['third location', w => w.locations.other = { ...w.locations[room], locationId: 'other', adjacentLocationIds: [] }],
  ['missing pickup', w => w.eventJournal = w.eventJournal.filter((e: any) => e.type !== 'PickupScopeInitialized')],
  ['missing known fact', w => w.player.knownFactIds = w.player.knownFactIds.filter((id: string) => id !== 'known-building-scene')],
  ['missing knowledge', w => { w.knowledge = w.knowledge.filter((k: any) => k.factId !== 'known-building-scene'); w.player.knownFactIds.pop(); }],
  ['wrong source', w => fact(w).source = 'evt-initial-route'], ['wrong knower', w => fact(w).knowerId = 'other'],
  ['confidence', w => fact(w).confidence = .5], ['expiry', w => fact(w).expiresAt = 0], ['knowledge time', w => fact(w).observedAt = 1],
  ['missing initialization', w => w.eventJournal.pop()],
  ['extra source knowledge', w => { w.knowledge.push({ ...fact(w), factId: 'extra' }); w.player.knownFactIds.push('extra'); }],
  ['reserved unknown event', w => w.eventJournal.push({ ...init(w), eventId: 'rogue', type: 'Other', payload: { rule: 'building-scene-v99' } })],
];
test.each(corruptions)('rejects damaged building provenance: %s', (_name, mutate) => {
  const w: any = clone(createBuildingPrototype()); mutate(w); renumber(w);
  expect(() => parseWorldState(w)).toThrow(); expect(() => createEngine(w)).toThrow();
});
test('cannot compose twice or after actions; relocating initialization after an action is rejected', () => {
  expect(() => addBuildingScene(createBuildingPrototype())).toThrow();
  const e = createEngine(createPickupPrototype()); expect(e.dispatch(action('observe', 0)).ok).toBe(true);
  expect(() => addBuildingScene(e.snapshot())).toThrow();
  const b = createEngine(createBuildingPrototype()); expect(b.dispatch(action('observe', 0)).ok).toBe(true);
  const w: any = clone(b.snapshot()), event = init(w); w.eventJournal = w.eventJournal.filter((x: any) => x !== event); w.eventJournal.push(event); renumber(w);
  expect(() => createEngine(w)).toThrow();
});
test('24 successful mixed actions reconstruct and replay all old IDs with identical location, ownership and RNG', () => {
  const initial = createBuildingGame(doorCharacter, doorMetadata), old = createPickupGame(doorCharacter, doorMetadata);
  let e = createEngine(initial); const reference = createEngine(old), isolated = createEngine(initial), commands: unknown[] = [];
  const sequence: [string, string?][] = [['observe'], ['observe', 'prototype-door-gap'], ['search', room], ['inspect', tin], ['pick_up', tin]];
  while (sequence.length < 24) sequence.push(...([['move', corridor], ['observe'], ['move', room], ['search', room], ['observe', 'prototype-door-gap']] as [string, string?][]).slice(0, 24 - sequence.length));
  for (const [verb, target] of sequence) {
    const c = action(verb, commands.length, target, doorMetadata.playerId); commands.push(c);
    expect(e.dispatch(c).ok).toBe(true); expect(reference.dispatch(c).ok).toBe(true);
    const s = e.snapshot(), r = reference.snapshot();
    expect(s.items).toEqual(r.items); expect(s.player.stats).toEqual(r.player.stats); expect(s.player.locationId).toBe(r.player.locationId);
    expect(s.campaign).toEqual(r.campaign); expect(s.rngState).toEqual(r.rngState); expect(s.npcs).toEqual(r.npcs);
    expect(readBuildingScene(s)?.roomId).toBe(room);
    e = createEngine(clone(s)); const recovered = e.snapshot();
    for (const previous of commands) { expect(e.dispatch(previous)).toMatchObject({ ok: true, replayed: true }); expect(e.snapshot()).toBe(recovered); }
  }
  expect(e.snapshot().campaign.worldRevision).toBe(24); expect(e.snapshot().items[tin]!.position.kind).toBe('player');
  expect(e.snapshot().player.stats.carryWeightKg).toBe(.05); expect(isolated.snapshot()).toEqual(initial);
});
test('baseline picked world retains exact sample and every prior receipt, with no inferred building identity', () => {
  const p = JSON.parse(readFileSync('docs/evidence/g1-010/legacy-provenance.json', 'utf8'));
  expect(createHash('sha256').update(readFileSync(p.file)).digest('hex')).toBe(p.sha256);
  const e = createEngine(JSON.parse(readFileSync(p.file, 'utf8'))), original = e.snapshot();
  expect(readBuildingScene(original)).toBeNull(); expect(original.player.stats.carryWeightKg).toBe(.05);
  for (const c of p.requests) { expect(e.dispatch(c)).toMatchObject({ ok: true, replayed: true }); expect(e.snapshot()).toBe(original); }
  expect(e.dispatch(action('observe', 8, undefined, original.player.playerId)).ok).toBe(true);
});
