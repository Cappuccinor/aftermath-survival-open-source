import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { createBuildingGame, createBuildingPrototype } from '../core/building-prototype';
import { createCabinetPrototype, addCabinetScene } from '../core/cabinet-prototype';
import { parseWorldState } from '../core/world';
import { createEngine } from '../core/engine';
import { doorCharacter, doorMetadata } from './door-fixtures';
import { action, clone, room, corridor, cabinet, water } from './cabinet-fixtures';
function snapshots(dir: string): string[] { return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? snapshots(join(dir, e.name)) : e.name.endsWith('.json') ? [join(dir, e.name)] : []); }
test.each(snapshots('src/tests/snapshots'))('old snapshot %s roundtrips without new entities', file => {
  const w = JSON.parse(readFileSync(file, 'utf8')); expect(parseWorldState(w)).toEqual(w);
  expect(createEngine(w).snapshot()).toEqual(w); expect(w.items[cabinet]).toBeUndefined();
});
test('old building factories stay cabinet-free and adding scope requires untouched new world', () => {
  for (const w of [createBuildingPrototype(), createBuildingGame(doorCharacter, doorMetadata)]) {
    expect(w.items[cabinet]).toBeUndefined(); expect(w.items[water]).toBeUndefined(); expect(parseWorldState(w)).toEqual(w);
    const withCabinet = addCabinetScene(w); expect(() => addCabinetScene(withCabinet)).toThrow();
    const e = createEngine(w); e.dispatch(action('observe', 0, undefined, w.player.playerId)); expect(() => addCabinetScene(e.snapshot())).toThrow();
  }
});
const corruptions: [string, (w: any) => void][] = [
  ['missing cabinet', w => delete w.items[cabinet]], ['missing water', w => delete w.items[water]],
  ['water moved', w => w.items[water].position = { kind: 'location', id: room }],
  ['wrong container', w => w.items[water].position.id = 'prototype-tin'], ['count', w => w.items[water].count = 2],
  ['weight', w => w.items[water].weightKg = 1], ['condition', w => w.items[water].condition = 'safe'], ['metadata', w => w.items[water].metadata = { hidden: 'secret' }],
  ['cabinet moved', w => w.items[cabinet].position.id = corridor],
  ['copied water', w => w.items.copy = { ...w.items[water], itemId: 'copy' }],
  ['copied contents', w => w.items.copy = { ...w.items[water], itemId: 'copy', typeId: 'other' }],
  ['duplicate scope', w => w.eventJournal.push({ ...w.eventJournal.at(-1), eventId: 'copy-scope', seq: w.eventJournal.length + 1 })],
  ['scope rule', w => w.eventJournal.at(-1).payload.rule = 'cabinet-scope-v9'],
  ['scope source', w => w.eventJournal.at(-1).payload.buildingSourceEventId = 'other'],
  ['scope time', w => { w.campaign.gameClockMinutes = 1; w.eventJournal.at(-1).worldTimeMinutes = 1; }],
  ['scope visibility', w => w.eventJournal.at(-1).visibility = 'public'],
  ['cabinet knowledge removed', w => { w.knowledge.pop(); w.player.knownFactIds.pop(); }],
  ['knowledge source', w => w.knowledge.at(-1).source = 'evt-initial-building-scene'],
  ['water initially known', w => { w.knowledge.push({ ...w.knowledge.at(-1), factId: `cabinet-discovery-${water}` }); w.player.knownFactIds.push(`cabinet-discovery-${water}`); }],
  ['no scope', w => { w.eventJournal.pop(); w.knowledge.pop(); w.player.knownFactIds.pop(); }],
];
test.each(corruptions)('rejects forged init: %s', (_, mutate) => {
  const w: any = clone(createCabinetPrototype()); mutate(w); expect(() => parseWorldState(w)).toThrow();
});
test.each(['orphan discovery', 'orphan time', 'receipt target', 'receipt rule', 'first source', 'first time', 'duplicate discovery', 'historical location', 'missing knowledge', 'discovery ID'])('rejects forged action history: %s', mode => {
  const e = createEngine(createCabinetPrototype()); expect(e.dispatch(action('search', 0, cabinet)).ok).toBe(true);
  const w: any = clone(e.snapshot()), r = w.eventJournal.at(-2), d = w.eventJournal.at(-1);
  if (mode === 'orphan discovery') w.eventJournal.splice(-3, 2);
  if (mode === 'orphan time') w.eventJournal.splice(-2, 2);
  if (mode === 'receipt target') r.payload.request.cabinetId = 'prototype-tin';
  if (mode === 'receipt rule') r.payload.rule = 'search-v1';
  if (mode === 'first source') w.knowledge.at(-1).source = r.eventId;
  if (mode === 'first time') w.knowledge.at(-1).observedAt = 0;
  if (mode === 'duplicate discovery') w.eventJournal.push({ ...d, eventId: 'copy-discovery' });
  if (mode === 'historical location') r.payload.request.locationId = corridor;
  if (mode === 'missing knowledge') { w.knowledge.pop(); w.player.knownFactIds.pop(); }
  if (mode === 'discovery ID') d.payload.itemId = 'prototype-tin';
  w.eventJournal.forEach((x: any, i: number) => x.seq = i + 1);
  expect(() => createEngine(w)).toThrow();
});
