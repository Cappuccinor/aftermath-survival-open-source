import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createEngine } from '../core/engine';
import { parseWorldState } from '../core/world';
import { createTransferPrototype } from '../core/transfer-prototype';
import { createHiddenItemPrototype, addHiddenNpcItem } from '../core/npc-hidden-item-prototype';
import { doorVectors } from './door-fixtures';
import { gun, gunType, hiddenInit, hiddenEntries, sequence, action, clone, tin, water, room, corridor } from './hidden-item-fixtures';
const init = (w: any) => w.eventJournal.find((e: any) => e.eventId === hiddenInit);
function candidate(): any {
  const w = clone(createTransferPrototype(1)), npcId = w.npcs[0]!.npcId;
  const item = { itemId: gun, typeId: gunType, position: { kind: 'npc', id: npcId }, count: 1, weightKg: 1, durability: 100, condition: 'concealed', metadata: {} };
  return { ...w, items: { ...w.items, [gun]: item }, eventJournal: [...w.eventJournal, { eventId: hiddenInit, seq: w.eventJournal.length + 1, type: 'NpcHiddenItemInitialized', actorId: w.player.playerId,
    targetIds: [npcId, gun], visibility: 'private', worldTimeMinutes: 0, payload: { rule: 'npc-hidden-item-scope-v1', playerId: w.player.playerId, npcId,
      doorSourceEventId: 'evt-initial-door-gap', transferSourceEventId: 'evt-initial-transfer', initialItem: clone(item) } }] };
}
function oldDomain(input: unknown) { const w: any = clone(input); delete w.items[gun]; w.eventJournal = w.eventJournal.filter((e: any) => e.eventId !== hiddenInit).map((e: any, i: number) => ({ ...e, seq: i + 1 })); return w; }
test.each(hiddenEntries)('%s initializes true unique NPC item without player knowledge/time/weight/RNG changes', (_, factory, old) => {
  const w = factory(); expect(w.items[gun]).toEqual({ ...candidate().items[gun], position: { kind: 'npc', id: w.npcs[0]!.npcId } });
  expect(oldDomain(w)).toEqual(old()); expect(w.eventJournal.at(-1)?.type).toBe('NpcHiddenItemInitialized');
  expect(() => addHiddenNpcItem(w)).toThrow(); expect(() => parseWorldState(candidate())).not.toThrow();
});
test.each(hiddenEntries)('%s two pickup orders24 mixed steps preserve complete old domain/receipts and every replay after JSON rebuild', (_, factory, old) => {
  for (const first of [tin, water]) {
    let e = createEngine(factory()); const baseline = createEngine(old()), initial = e.snapshot(), commands: ReturnType<typeof action>[] = [], receipts: unknown[] = [];
    for (const [n, [verb, target]] of sequence(first).entries()) {
      const c = action(verb, n, target, initial.player.playerId), actual = e.dispatch(c), expected = baseline.dispatch(c);
      expect(actual.ok, `step${n}`).toBe(true); expect(expected.ok).toBe(true); if (!actual.ok || !expected.ok) throw Error('action failed');
      expect(actual.receipt).toEqual(expected.receipt); expect(oldDomain(e.snapshot())).toEqual(baseline.snapshot());
      expect(e.snapshot().items[gun]).toEqual(candidate().items[gun]); expect(e.snapshot().items[gun]!.position.id).toBe(e.snapshot().npcs[0]!.npcId);
      commands.push(c); receipts.push(actual.receipt); const before = e.snapshot(); e = createEngine(clone(before)); expect(e.snapshot()).toEqual(before);
      const restored = e.snapshot(); commands.forEach((request, i) => { expect(e.dispatch(request)).toMatchObject({ ok: true, replayed: true, receipt: receipts[i] }); expect(e.snapshot()).toBe(restored); });
    }
    expect(e.snapshot().player.stats.carryWeightKg).toBe(.55); expect(() => addHiddenNpcItem(e.snapshot())).toThrow();
  }
});
test.each(doorVectors)('hidden item preserves door vector seed $seed', vector => {
  const hidden = createEngine(createHiddenItemPrototype(vector.seed)), old = createEngine(createTransferPrototype(vector.seed));
  const c = action('observe', 0, 'prototype-door-gap'); const a = hidden.dispatch(c), b = old.dispatch(c);
  expect(a).toMatchObject({ ok: true, receipt: { visual: vector.visual, noticed: vector.noticed } });
  expect(a.ok && a.receipt).toEqual(b.ok && b.receipt); expect(oldDomain(hidden.snapshot())).toEqual(old.snapshot());
  expect(hidden.snapshot().items[gun]).toBeDefined();
});
const mutations: [string, (w: any) => void][] = [
  ['missing scope', w => w.eventJournal.pop()], ['missing item', w => delete w.items[gun]], ['missing NPC', w => w.npcs = []],
  ['wrong owner', w => w.items[gun].position.id = 'other-npc'], ['wrong type', w => w.items[gun].typeId = 'other'],
  ['wrong count', w => w.items[gun].count = 2], ['wrong weight', w => w.items[gun].weightKg = 2],
  ['changed durability', w => w.items[gun].durability = 50], ['changed condition', w => w.items[gun].condition = 'ready'], ['extra metadata', w => w.items[gun].metadata.secret = true],
  ['room transfer', w => w.items[gun].position = { kind: 'location', id: room }], ['player transfer', w => w.items[gun].position = { kind: 'player', id: w.player.playerId }],
  ['container transfer', w => w.items[gun].position = { kind: 'container', id: 'prototype-cabinet' }],
  ['duplicate ID', w => w.items.copy = clone(w.items[gun])], ['extra gun', w => w.items.copy = { ...clone(w.items[gun]), itemId: 'copy' }],
  ['other NPC item', w => w.items.copy = { ...clone(w.items[gun]), itemId: 'copy', typeId: 'other' }],
  ['extra gun on floor', w => w.items.copy = { ...clone(w.items[gun]), itemId: 'copy', position: { kind: 'location', id: room } }],
  ['wrong source', w => init(w).payload.doorSourceEventId = 'evt-initial-cabinet'], ['wrong transfer source', w => init(w).payload.transferSourceEventId = 'evt-initial-pickup'],
  ['scope player', w => init(w).payload.playerId = 'other'], ['scope owner', w => init(w).payload.npcId = 'other'],
  ['scope initial forged', w => { init(w).payload.initialItem.weightKg = 2; w.items[gun].weightKg = 2; }],
  ['scope target', w => init(w).targetIds = [gun]], ['scope public', w => init(w).visibility = 'public'], ['scope actor', w => init(w).actorId = null],
  ['scope rule', w => init(w).payload.rule = 'npc-hidden-item-scope-v2'], ['scope duplicate', w => w.eventJournal.push({ ...clone(init(w)), eventId: 'duplicate' })],
  ['orphan init ID', w => { init(w).payload = {}; init(w).type = 'Other'; }],
  ['init not immediately after transfer', w => { const e = w.eventJournal.pop(); w.eventJournal.splice(w.eventJournal.length - 1, 0, e); }],
];
test.each(mutations)('world rejects %s', (_, mutate) => { const w = candidate(); mutate(w); w.eventJournal.forEach((e: any, i: number) => e.seq = i + 1); expect(() => parseWorldState(w)).toThrow(); });
test.each(['source-init', 'source-door-init', 'source-observe', 'source-unknown', 'known-id-only'])('world rejects invented player gun knowledge %s', mode => {
  const w = candidate();
  if (mode === 'source-observe') { const old = createEngine(createTransferPrototype()); old.dispatch(action('observe', 0)); const acted: any = clone(old.snapshot()); w.eventJournal.push(...acted.eventJournal.slice(-2)); w.campaign = acted.campaign; }
  const id = `seen-item-${gun}`; w.player.knownFactIds.push(id);
  if (mode !== 'known-id-only') w.knowledge.push({ knowerId: w.player.playerId, factId: id, source: mode === 'source-init' ? hiddenInit : mode === 'source-door-init' ? 'evt-initial-door-gap' : mode === 'source-observe' ? 'evt-mixed-0-observation' : 'guessed', confidence: 1, observedAt: 0 });
  w.eventJournal.forEach((e: any, i: number) => e.seq = i + 1); expect(() => parseWorldState(w)).toThrow();
});
test('scope cannot be appended after action or arbitrary NPC position enabled without capability', () => {
  const old = createEngine(createTransferPrototype()); old.dispatch(action('observe', 0)); expect(() => addHiddenNpcItem(old.snapshot())).toThrow();
  const w: any = clone(old.snapshot()); w.items[tin].position = { kind: 'npc', id: w.npcs[0].npcId }; expect(() => parseWorldState(w)).toThrow();
  const late = candidate(), event = late.eventJournal.pop(); late.eventJournal.push(...w.eventJournal.slice(-2), event); late.campaign = w.campaign;
  late.eventJournal.forEach((e: any, i: number) => e.seq = i + 1); expect(() => parseWorldState(late)).toThrow();
});
test.each(['inspect', 'search', 'pick_up'])('guessing %s gun/NPC/type/unknown with tools/params/stale rejects without revealing or mutating', verb => {
  const e = createEngine(createHiddenItemPrototype());
  for (const target of [gun, gunType, e.snapshot().npcs[0]!.npcId, 'unknown']) for (const variant of ['normal', 'tools', 'args', 'stale']) {
    const c: any = action(verb, 0, target); if (variant === 'tools') c.toolIds = [gun]; if (variant === 'args') c.arguments = { reveal: true }; if (variant === 'stale') c.expectedWorldRevision = 1;
    const before = e.snapshot(), r = e.dispatch(c); expect(r.ok).toBe(false); expect(e.snapshot()).toBe(before); expect(JSON.stringify(r)).not.toMatch(/handgun|npc|concealed|scope|枪/);
  }
  expect(e.dispatch(action('observe', 0)).ok).toBe(true);
});
test('actual accepted G15 sample remains byte-fixed, unchanged and all prior commands replay without new capability', () => {
  const p = JSON.parse(readFileSync('docs/evidence/g1-016/legacy-provenance.json', 'utf8')), bytes = readFileSync(p.file), w = JSON.parse(bytes.toString());
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(p.sha256); const e = createEngine(w); expect(e.snapshot()).toEqual(w); expect(e.snapshot().items[gun]).toBeUndefined();
  for (const c of p.requests) expect(e.dispatch(c)).toMatchObject({ ok: true, replayed: true });
  expect(e.snapshot()).toEqual(w);
});
test('new initial and acted snapshots retain true ownership, all original receipts and original world fields', () => {
  const p = JSON.parse(readFileSync('docs/evidence/g1-016/new-snapshot-provenance.json', 'utf8'));
  for (const sample of p.files) {
    const bytes = readFileSync(sample.file); expect(createHash('sha256').update(bytes).digest('hex')).toBe(sample.sha256);
    const w = JSON.parse(bytes.toString()), e = createEngine(w); expect(e.snapshot()).toEqual(w);
    expect(e.snapshot().items[gun]).toEqual(candidate().items[gun]);
    for (const c of sample.requests) expect(e.dispatch(c)).toMatchObject({ ok: true, replayed: true });
    expect(e.snapshot()).toEqual(w); expect(e.dispatch(action('observe', w.campaign.worldRevision)).ok).toBe(true);
  }
});
test.each(['unrelated-fact', 'init-as-proof', 'private-time-as-proof', 'fake-gun-perception'])('rejects forged %s added to otherwise valid acted hidden world', mode => {
  const e = createEngine(createHiddenItemPrototype()); expect(e.dispatch(action('observe', 0)).ok).toBe(true);
  const w: any = clone(e.snapshot()), id = mode === 'unrelated-fact' ? 'arbitrary-claim' : `seen-item-${gun}`;
  w.player.knownFactIds.push(id); w.knowledge.push({ knowerId: w.player.playerId, factId: id, confidence: 1, observedAt: 1,
    source: mode === 'init-as-proof' ? hiddenInit : mode === 'private-time-as-proof' ? 'evt-mixed-0-time' : 'evt-mixed-0-observation' });
  expect(() => parseWorldState(w)).toThrow();
});
