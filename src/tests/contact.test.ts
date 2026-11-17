import { expect, test } from 'vitest';
import { createEngine } from '../core/engine';
import { createContactPrototype, upgradeContactWorld } from '../core/contact-prototype';
import { createLifecyclePrototype } from '../core/npc-lifecycle-prototype';
import { createHiddenItemPrototype } from '../core/npc-hidden-item-prototype';
import { createWorldState, parseWorldState } from '../core/world';
import { readActionReceipts } from '../core/receipts';

type Engine = ReturnType<typeof createEngine>;
const clone = (value: unknown): any => JSON.parse(JSON.stringify(value));
function command(e: Engine, verb = 'talk', target = e.snapshot().player.locationId, id = `contact-${e.snapshot().campaign.worldRevision}`) {
  return { commandId: id, actorId: e.snapshot().player.playerId, source: 'text', verb, targetIds: [target], toolIds: [],
    arguments: verb === 'talk' ? { topic: 'greeting' } : verb === 'observe' ? { through: 'door_gap', careful: true } : {},
    utterance: '向周围打招呼', expectedWorldRevision: e.snapshot().campaign.worldRevision };
}
function act(e: Engine, verb = 'talk', target = e.snapshot().player.locationId) {
  const c = command(e, verb, target), r = e.dispatch(c); expect(r.ok, JSON.stringify(r)).toBe(true);
  if (!r.ok) throw Error(r.code); return { c, r };
}
const arrive = (e: Engine) => act(e, 'move', 'prototype-corridor');
function greeted() { const e = createEngine(createContactPrototype()); arrive(e); act(e); act(e); return e; }

test('real first warning, ignored boundary and then silence persist causal memory, not repeat points', () => {
  const e = createEngine(createContactPrototype()); const initial = e.snapshot(); arrive(e);
  const first = act(e); expect(first.r.receipt).toMatchObject({ rule: 'talk-v1', result: 'first_warning', alertnessBefore: 30 });
  expect(e.snapshot().relationships).toEqual([{ kind: 'g2-contact-relation-v1', fromNpcId: 'prototype-witness',
    toPlayerId: initial.player.playerId, hostility: 20, stance: 'wary', firstSourceEventId: 'evt-contact-1-contact-relation', lastSourceEventId: 'evt-contact-1-contact-relation' }]);
  const second = act(e); expect(second.r.receipt).toMatchObject({ result: 'repeated_warning' });
  expect(e.snapshot().relationships[0]).toMatchObject({ hostility: 40, stance: 'avoidant', lastSourceEventId: 'evt-contact-2-contact-relation' });
  const before = e.snapshot(); const third = act(e); expect(third.r.receipt).toMatchObject({ result: 'silence_after_warning' });
  expect(e.snapshot().relationships).toEqual(before.relationships);
  expect((e.snapshot() as any).npcMemories.map((m: any) => m.fact)).toEqual(['warning_given', 'warning_ignored']);
  expect((e.snapshot() as any).npcMemories).toEqual((before as any).npcMemories);
  expect(e.snapshot().eventJournal.length - before.eventJournal.length).toBe(2);
  expect(e.snapshot().campaign).toMatchObject({ worldRevision: 4, gameClockMinutes: 4 });
  expect(e.snapshot().rngState).toEqual(initial.rngState);
  expect(e.snapshot().items).toEqual(initial.items); expect(e.snapshot().npcs).toEqual(initial.npcs);
  expect(e.snapshot().knowledge.filter(k => k.factId.startsWith('contact-heard-'))).toEqual([
    { knowerId: initial.player.playerId, factId: 'contact-heard-prototype-witness', source: 'evt-contact-1-contact-heard', confidence: 1, observedAt: 2 },
  ]);
  expect(createEngine(clone(e.snapshot())).snapshot()).toEqual(e.snapshot());
});

test('high historical alertness causes stronger first refusal; later alertness never rewrites its past', () => {
  const e = createEngine(createContactPrototype(1));
  for (let n = 0; n < 30 && e.snapshot().npcs[0]!.alertness < 50; n++) act(e, 'observe', 'prototype-door-gap');
  expect(e.snapshot().npcs[0]!.alertness).toBeGreaterThanOrEqual(50);
  arrive(e); const first = act(e); expect(first.r.receipt).toMatchObject({ result: 'first_warning' });
  expect(e.snapshot().relationships[0]).toMatchObject({ hostility: 60, stance: 'avoidant' });
  act(e); expect(e.snapshot().relationships[0]).toMatchObject({ hostility: 80 });
  act(e, 'move', 'prototype-location'); act(e, 'observe', 'prototype-door-gap');
  expect(readActionReceipts(e.snapshot()).find(r => r.commandId === first.c.commandId)).toEqual(first.r.receipt);
});

test.each(['dead', 'legacy', 'empty', 'remote'] as const)('%s does not respond, acquire memory or reveal identity', kind => {
  const world = kind === 'dead' ? createContactPrototype(1, 'dead') : kind === 'legacy' ? upgradeContactWorld(createHiddenItemPrototype())
    : kind === 'empty' ? upgradeContactWorld(createWorldState({ seed: 1, saveId: 'empty-save', playerId: 'p', locationId: 'empty-room', createdAt: '2026-10-26T00:00:00.000Z' })) : createContactPrototype();
  const e = createEngine(world); if (kind === 'dead' || kind === 'legacy') arrive(e);
  const before = e.snapshot(), r = act(e).r;
  expect(r.receipt).toMatchObject({ result: 'no_response', npcId: null });
  expect(e.snapshot().relationships).toEqual([]); expect((e.snapshot() as any).npcMemories).toEqual([]);
  expect(e.snapshot().npcs).toEqual(before.npcs); expect(e.snapshot().knowledge).toEqual(before.knowledge);
  expect(e.snapshot().rngState).toEqual(before.rngState); expect(e.snapshot().eventJournal.length - before.eventJournal.length).toBe(2);
});

test('old v1 remains v1, cannot run talk or carry v2 semantics even if relabelled', () => {
  const old = createLifecyclePrototype(), e = createEngine(old); expect(e.dispatch(command(e))).toEqual({ ok: false, code: 'unsupported_action' });
  expect(e.snapshot()).toEqual(old);
  const newer = clone(createContactPrototype()); newer.stateSchema = 'g0-world-v1'; expect(() => parseWorldState(newer)).toThrow();
  const acted = clone(greeted().snapshot()); delete acted.npcMemories; acted.relationships = []; acted.stateSchema = 'g0-world-v1';
  expect(() => createEngine(acted)).toThrow();
});

test.each(['target', 'unknown', 'parameters', 'tool', 'actor', 'stale', 'hp'] as const)('%s rejection has no partial time, knowledge or relation side effect', kind => {
  const w = clone(createContactPrototype()); if (kind === 'hp') w.player.stats.hp = 0;
  const e = createEngine(w), before = e.snapshot(), c: any = command(e);
  if (kind === 'target') c.targetIds = ['prototype-corridor'];
  if (kind === 'unknown') c.targetIds = ['unknown-place'];
  if (kind === 'parameters') c.arguments = { topic: 'become_friends' };
  if (kind === 'tool') c.toolIds = ['prototype-tin'];
  if (kind === 'actor') c.actorId = 'prototype-witness';
  if (kind === 'stale') c.expectedWorldRevision = 100;
  expect(e.dispatch(c).ok).toBe(false); expect(e.snapshot()).toEqual(before);
});

test('same ID after JSON reconstruction and moving back replays only; altered requests conflict', () => {
  let e = createEngine(createContactPrototype()); arrive(e); const first = act(e); act(e); act(e, 'move', 'prototype-location');
  e = createEngine(clone(e.snapshot())); const before = e.snapshot();
  const replay = e.dispatch(first.c); expect(replay).toMatchObject({ ok: true, replayed: true, receipt: first.r.receipt });
  expect(e.snapshot()).toBe(before);
  for (const patch of [{ targetIds: ['prototype-location'] }, { expectedWorldRevision: 9 }, { arguments: { topic: 'other' } }]) {
    expect(e.dispatch({ ...first.c, ...patch }).ok).toBe(false); expect(e.snapshot()).toBe(before);
  }
});

test('unwitnessed player searching and picking up never adds NPC memory', () => {
  const e = createEngine(createContactPrototype()); act(e, 'search', 'prototype-location'); act(e, 'pick_up', 'prototype-tin');
  expect((e.snapshot() as any).npcMemories).toEqual([]); expect(e.snapshot().relationships).toEqual([]);
  arrive(e); act(e); expect((e.snapshot() as any).npcMemories.map((m: any) => m.fact)).toEqual(['warning_given']);
});

const mutations: [string, (w: any) => void][] = [
  ['relation value', w => w.relationships[0].hostility = 41],
  ['relation direction', w => w.relationships[0].fromNpcId = w.player.playerId],
  ['relation evidence', w => w.relationships[0].firstSourceEventId = 'evt-made-up'],
  ['missing relationship', w => w.relationships = []],
  ['missing memory', w => w.npcMemories.pop()],
  ['fabricated memory', w => w.npcMemories[0].fact = 'theft_seen'],
  ['memory wrong observer', w => w.npcMemories[0].npcId = w.player.playerId],
  ['memory false source', w => w.npcMemories[0].sourceEventId = 'evt-initial-route'],
  ['memory duplication', w => w.npcMemories.push(clone(w.npcMemories[0]))],
  ['wrong response actor', w => w.eventJournal.find((e: any) => e.type === 'NPCContactResponse').actorId = w.player.playerId],
  ['wrong old event actor', w => w.eventJournal.find((e: any) => e.type === 'PlayerMoved').actorId = 'prototype-witness'],
  ['relation event before', w => w.eventJournal.findLast((e: any) => e.type === 'NPCContactRelationChanged').payload.before.hostility = 19],
  ['first historical alertness', w => w.eventJournal.find((e: any) => e.type === 'GreetingRecorded').payload.alertnessBefore = 60],
  ['invented perceived evidence', w => w.knowledge.find((k: any) => k.factId.startsWith('contact-heard-')).source = 'evt-initial-route'],
  ['missing known fact', w => w.player.knownFactIds = w.player.knownFactIds.filter((id: string) => !id.startsWith('contact-heard-'))],
  ['reserved orphan', w => w.eventJournal.push({ ...clone(w.eventJournal.at(-1)), eventId: 'evt-orphan', seq: w.eventJournal.length + 1 })],
  ['swap group order', w => { const i = w.eventJournal.findIndex((e: any) => e.type === 'NPCContactResponse'); [w.eventJournal[i], w.eventJournal[i+1]] = [w.eventJournal[i+1], w.eventJournal[i]]; w.eventJournal.forEach((e: any, n: number) => e.seq = n+1); }],
];
test.each(mutations)('rejects all of candidate with %s corruption', (_, mutate) => {
  const w = clone(greeted().snapshot()); mutate(w); expect(() => createEngine(w)).toThrow();
});
