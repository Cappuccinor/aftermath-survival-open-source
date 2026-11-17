import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createEngine } from '../core/engine';
import { parseWorldState } from '../core/world';
import { createTransferPrototype, addTransferScope } from '../core/transfer-prototype';
import { createCabinetPrototype, createCabinetGame } from '../core/cabinet-prototype';
import { doorCharacter, doorMetadata } from './door-fixtures';
import { action, clone, water, tin, cabinet, room, corridor, bothDiscovered } from './transfer-fixtures';
const scope = (w: any) => w.eventJournal.find((e: any) => e.type === 'TransferScopeInitialized');
const transferred = () => { const e = bothDiscovered(); expect(e.dispatch(action('pick_up', 2, water)).ok).toBe(true); expect(e.dispatch(action('pick_up', 3, tin)).ok).toBe(true); return clone(e.snapshot()) as any; };
const receipt = (w: any) => w.eventJournal.find((e: any) => e.type === 'ItemTransferred');
test('representative water-only and both-owned snapshots preserve inventory and historical search receipts on retry', () => {
  const samples = JSON.parse(readFileSync('docs/evidence/g1-015/new-snapshot-provenance.json', 'utf8'));
  for (const sample of samples.files) {
    const bytes = readFileSync(sample.file); expect(createHash('sha256').update(bytes).digest('hex')).toBe(sample.sha256);
    const e = createEngine(JSON.parse(bytes.toString())), w = e.snapshot();
    expect(w.items[water]!.position).toEqual({ kind: 'player', id: 'prototype-player' });
    expect(w.player.stats.carryWeightKg).toBe(sample.requests.length === 3 ? .5 : .55);
    for (const c of sample.requests) { expect(e.dispatch(c)).toMatchObject({ ok: true, replayed: true }); expect(e.snapshot()).toBe(w); }
    expect(e.dispatch(action('search', w.campaign.worldRevision, cabinet))).toMatchObject({ ok: true, receipt: { rule: 'cabinet-search-v2', waterLocation: 'player', discoveredItemId: null } });
  }
});
test('legacy G1-014 snapshot and factories keep original search and no water pickup capability', () => {
  const p = JSON.parse(readFileSync('docs/evidence/g1-015/legacy-provenance.json', 'utf8')), bytes = readFileSync(p.file), old = JSON.parse(bytes.toString());
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(p.sha256); expect(parseWorldState(old)).toEqual(old);
  const e = createEngine(old), before = e.snapshot(); for (const c of p.requests) { expect(e.dispatch(c)).toMatchObject({ ok: true, replayed: true }); expect(e.snapshot()).toBe(before); }
  for (const w of [createCabinetPrototype(), createCabinetGame(doorCharacter, doorMetadata)]) {
    const engine = createEngine(w), actor = w.player.playerId; expect(scope(w)).toBeUndefined();
    expect(engine.dispatch(action('search', 0, cabinet, actor))).toMatchObject({ ok: true, receipt: { rule: 'cabinet-search-v1' } });
    expect(engine.dispatch(action('pick_up', 1, water, actor))).toEqual({ ok: false, code: 'invalid_target' });
    expect(() => addTransferScope(engine.snapshot())).toThrow();
  }
  expect(() => addTransferScope(createTransferPrototype())).toThrow();
});
const initialMutations: [string, (w: any) => void][] = [
  ['scope rule', w => scope(w).payload.rule = 'dual-transfer-scope-v9'], ['source', w => scope(w).payload.cabinetSourceEventId = 'other'],
  ['player', w => scope(w).payload.playerId = 'other'], ['room', w => scope(w).payload.locationId = corridor],
  ['original water', w => scope(w).payload.initialWater.count = 2], ['original tin', w => scope(w).payload.initialTin.weightKg = .5],
  ['initial carry', w => scope(w).payload.initialCarryWeightKg = .5], ['duplicate scope', w => w.eventJournal.push({ ...scope(w), eventId: 'duplicate' })],
  ['scope actor', w => scope(w).actorId = null], ['scope visibility', w => scope(w).visibility = 'public'], ['scope target', w => scope(w).targetIds = [room]],
  ['orphan v2', w => { w.eventJournal.pop(); w.eventJournal.push({ ...w.eventJournal.at(-1), type: 'Other', eventId: 'orphan', payload: { rule: 'pick_up-v2' } }); }],
];
test.each(initialMutations)('rejects forged capability %s', (_, mutate) => {
  const w: any = clone(createTransferPrototype()); mutate(w); w.eventJournal.forEach((e: any, i: number) => e.seq = i + 1); expect(() => parseWorldState(w)).toThrow();
});
const historyMutations: [string, (w: any) => void][] = [
  ['missing scope', w => w.eventJournal.splice(w.eventJournal.indexOf(scope(w)), 1)],
  ['scope late', w => { const s = scope(w); w.eventJournal.splice(w.eventJournal.indexOf(s), 1); w.eventJournal.push(s); }],
  ['missing transfer', w => w.eventJournal.splice(w.eventJournal.indexOf(receipt(w)), 1)],
  ['half position', w => w.items[water].position = { kind: 'container', id: cabinet }], ['wrong carry', w => w.player.stats.carryWeightKg = .5],
  ['copied bottle', w => w.items.copy = { ...w.items[water], itemId: 'copy' }], ['count', w => w.items[water].count = 2], ['weight', w => w.items[water].weightKg = 1],
  ['durability', w => w.items[water].durability = 99], ['metadata', w => w.items[water].metadata = { safe: true }], ['cabinet moved', w => w.items[cabinet].position.id = corridor],
  ['from', w => receipt(w).payload.from.id = tin], ['to', w => receipt(w).payload.to.id = 'other'], ['request location', w => receipt(w).payload.request.locationId = corridor],
  ['before carry', w => receipt(w).payload.beforeCarryWeightKg = .05], ['after carry', w => receipt(w).payload.afterCarryWeightKg = .55], ['count payload', w => receipt(w).payload.count = 2],
  ['source forged', w => receipt(w).payload.perceptionSourceEventId = 'evt-initial-cabinet'], ['target changed', w => receipt(w).payload.request.itemId = tin],
  ['duplicate', w => w.eventJournal.push({ ...receipt(w), eventId: 'duplicate' })], ['legacy rule in new scope', w => receipt(w).payload.rule = 'pick_up-v1'],
  ['source missing', w => w.eventJournal = w.eventJournal.filter((e: any) => e.type !== 'CabinetContentDiscovered')],
  ['discovery wrong time', w => w.eventJournal.find((e: any) => e.type === 'CabinetContentDiscovered').payload.observedAt = 1],
  ['knowledge missing', w => { w.knowledge = w.knowledge.filter((k: any) => !k.factId.startsWith('transfer-')); w.player.knownFactIds = w.player.knownFactIds.filter((id: string) => !id.startsWith('transfer-')); }],
  ['knowledge source', w => w.knowledge.find((k: any) => k.factId === `transfer-${water}`).source = 'evt-initial-cabinet'],
  ['orphan time', w => w.eventJournal.push({ ...w.eventJournal.find((e: any) => e.payload.rule === 'pick_up-v2'), eventId: 'orphan-time' })],
  ['wrong old search location', w => w.eventJournal.find((e: any) => e.payload.rule === 'cabinet-search-v2' && e.type === 'CabinetSearchRecorded').payload.waterLocation = 'player'],
];
test.each(historyMutations)('rejects partial/forged transfer history %s', (_, mutate) => {
  const w = transferred(); mutate(w); w.eventJournal.forEach((e: any, i: number) => e.seq = i + 1); expect(() => parseWorldState(w)).toThrow(); expect(() => createEngine(w)).toThrow();
});
