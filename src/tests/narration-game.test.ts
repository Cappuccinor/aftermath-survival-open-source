import { afterEach, expect, test, vi } from 'vitest';
import * as core from '../core/engine';
import { readActionReceipts } from '../core/receipts';
import { createBuildingPrototype } from '../core/building-prototype';
import { projectLocation, visibleRoutes } from '../core/movement';
import { visibleSearchTargets } from '../core/search';
import { projectClock } from '../application/clock';
import { projectSceneContext } from '../application/scene-context';
import { projectPlayerStatus } from '../application/player-status';
import { projectInventory } from '../application/inventory';
import { createGame } from '../application/game';
import { createObservationSession } from '../application/session';
import { localIntentInterpreter } from '../adapters/ai/local-intent';
import type { NarrationOptions } from '../application/narration';
import type { GameClient, PortResult, VisibleOutcome } from '../application/ports';
import { action, clone, corridor, room, tin } from './pickup-fixtures';
import { doorVectors, doorCommand, doorFixture } from './door-fixtures';

const originalEngine = core.createEngine;
function captureEngines() {
  const engines: ReturnType<typeof core.createEngine>[] = [];
  vi.spyOn(core, 'createEngine').mockImplementation(input => {
    const engine = originalEngine(input); engines.push(engine); return engine;
  });
  return engines;
}
const variant = (v: VisibleOutcome) => v.summary.replace(/。(?!$)/gu, '。\n');
function deferred() {
  let resolve!: (value: PortResult<string>) => void, reject!: (error: Error) => void;
  const promise = new Promise<PortResult<string>>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const world = () => createBuildingPrototype(35);
function session(client: GameClient, timeoutMs = 5000) {
  const w = world();
  return createObservationSession({ client, interpreter: localIntentInterpreter, actorId: w.player.playerId,
    initialClock: projectClock(w), initialLocation: projectLocation(w), initialRoutes: visibleRoutes(w),
    initialSearchTargets: visibleSearchTargets(w), initialPlayerStatus: projectPlayerStatus(w),
    initialInventory: projectInventory(w), initialSceneContext: projectSceneContext(w), timeoutMs });
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

test.each(['legal', 'forged', 'error', 'timeout'] as const)('24 mixed actions retain actual authoritative worlds and receipts with %s narrator', async mode => {
  vi.useFakeTimers(); const engines = captureEngines();
  const reference = createGame(world());
  const committedAtCall: number[] = [];
  const narrate = vi.fn(async (v: VisibleOutcome): Promise<PortResult<string>> => {
    committedAtCall.push(engines[1]!.snapshot().campaign.worldRevision);
    if (mode === 'timeout') return new Promise(() => {});
    if (mode === 'error') throw Error('provider unavailable');
    return { ok: true, value: mode === 'legal' ? variant(v) : v.summary + '你获得十把枪。' };
  });
  const tested = createGame(world(), { narrator: { narrate }, narrationTimeoutMs: 10 });
  const operations: [string, string?][] = [
    ['observe'], ['observe', 'prototype-door-gap'], ['search', room], ['inspect', tin], ['pick_up', tin],
    ['move', corridor], ['observe'], ['move', room], ['search', room], ['observe', 'prototype-door-gap'],
    ['move', corridor], ['observe'], ['move', room], ['search', room], ['observe', 'prototype-door-gap'],
    ['move', corridor], ['observe'], ['move', room], ['search', room], ['observe', 'prototype-door-gap'],
    ['move', corridor], ['observe'], ['move', room], ['observe', 'prototype-door-gap'],
  ];
  const before = clone(engines[0]!.snapshot());
  for (const [revision, [verb, target]] of operations.entries()) {
    const command = action(verb, revision, target);
    const expected = await reference.dispatch(command);
    const pending = tested.dispatch(command);
    if (mode === 'timeout') await vi.advanceTimersByTimeAsync(10);
    const actual = await pending;
    expect(actual.ok).toBe(true); expect(expected.ok).toBe(true);
    expect(engines[1]!.snapshot()).toEqual(engines[0]!.snapshot());
    expect(readActionReceipts(engines[1]!.snapshot())).toEqual(readActionReceipts(engines[0]!.snapshot()));
    if (!actual.ok || !expected.ok) throw Error('all 24 actions must succeed');
    expect({ ...actual, outcome: expected.outcome }).toEqual(expected);
    expect(actual.outcome.facts).toEqual(expected.outcome.facts);
    expect(actual.outcome.summary).toBe(mode === 'legal' ? variant(expected.outcome) : expected.outcome.summary);
  }
  const final = engines[1]!.snapshot();
  expect(final.campaign.worldRevision).toBe(24); expect(final.campaign.gameClockMinutes).toBe(24);
  expect(readActionReceipts(final)).toHaveLength(24); expect(narrate).toHaveBeenCalledTimes(24);
  expect(final.rngState).not.toEqual(before.rngState); expect(final.npcs).not.toEqual(before.npcs);
  expect(final.items[tin]!.position).toEqual({ kind: 'player', id: final.player.playerId });
  expect(before.items[tin]!.position).toEqual({ kind: 'location', id: room });
  expect(final.player.stats.carryWeightKg).toBe(0.05);
  expect(committedAtCall).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
  expect(final.player.stats).not.toEqual(before.player.stats);
  expect(final.player.locationId).toBe(room); expect(vi.getTimerCount()).toBe(0);
});

test('in-flight duplicate and old ID across locations use original template without repeating provider or rules', async () => {
  const engines = captureEngines(), late = deferred(); let view!: VisibleOutcome;
  const narrate = vi.fn((v: VisibleOutcome) => { view = v; return late.promise; });
  const game = createGame(world(), { narrator: { narrate } });
  const command = action('observe', 0), first = game.dispatch(command);
  await Promise.resolve(); const originalView = view;
  const duplicate = await game.dispatch(command);
  expect(duplicate).toMatchObject({ ok: true, replayed: true, outcome: { summary: originalView.summary }, clock: { worldRevision: 1 } });
  expect(narrate).toHaveBeenCalledTimes(1);
  late.resolve({ ok: true, value: variant(view) });
  expect(await first).toMatchObject({ ok: true, outcome: { summary: variant(originalView) } });
  await game.dispatch(action('move', 1, corridor));
  const replay = await game.dispatch(command);
  expect(replay).toMatchObject({ ok: true, committedRevision: 1, replayed: true, currentLocation: { targetId: corridor },
    sceneContext: { locationRole: 'corridor' }, clock: { worldRevision: 2 }, outcome: { summary: originalView.summary } });
  expect(narrate).toHaveBeenCalledTimes(2); expect(readActionReceipts(engines[0]!.snapshot())).toHaveLength(2);
  expect(await game.dispatch({ ...command, verb: 'move', targetIds: [room] })).toMatchObject({ ok: false, code: 'command_id_conflict' });
  expect(narrate).toHaveBeenCalledTimes(2);
});

test('different requests resolve out of order with their own immutable visible outcome and projection', async () => {
  const engines = captureEngines(), delayed = deferred(); let firstView!: VisibleOutcome, calls = 0;
  const game = createGame(world(), { narrator: { narrate: async v => {
    if (++calls === 1) { firstView = v; return delayed.promise; }
    return { ok: true, value: variant(v) };
  } } });
  const first = game.dispatch(action('observe', 0)); await Promise.resolve();
  const second = await game.dispatch(action('move', 1, corridor));
  expect(second).toMatchObject({ ok: true, clock: { worldRevision: 2 }, sceneContext: { locationRole: 'corridor' } });
  delayed.resolve({ ok: true, value: variant(firstView) });
  expect(await first).toMatchObject({ ok: true, clock: { worldRevision: 1 }, sceneContext: { locationRole: 'room' }, outcome: { summary: variant(firstView) } });
  expect(engines[0]!.snapshot().player.locationId).toBe(corridor);
});

test.each(['success', 'reject'])('session timeout confirmation and next action ignore late narrator %s', async mode => {
  vi.useFakeTimers(); const engines = captureEngines(), late = deferred(); let firstView!: VisibleOutcome;
  const narrate = vi.fn(async (v: VisibleOutcome): Promise<PortResult<string>> => {
    if (narrate.mock.calls.length === 1) { firstView = v; return late.promise; }
    return { ok: true, value: variant(v) };
  });
  const game = createGame(world(), { narrator: { narrate }, narrationTimeoutMs: 50 });
  const s = session(game, 5), initial = s.read();
  const first = s.move(corridor); await vi.advanceTimersByTimeAsync(5); await first;
  expect(s.read()).toMatchObject({ canRetry: true, phase: 'error', clock: initial.clock, sceneContext: initial.sceneContext });
  expect(engines[0]!.snapshot().campaign.worldRevision).toBe(1);
  s.setDraft('留下自由输入'); await s.retry();
  expect(s.read()).toMatchObject({ canRetry: false, phase: 'success', clock: { worldRevision: 1 }, sceneContext: { locationRole: 'corridor' }, draft: '留下自由输入' });
  expect(s.read().entries).toHaveLength(1); expect(narrate).toHaveBeenCalledTimes(1);
  await s.move(room); const current = s.read();
  expect(current.entries).toHaveLength(2); expect(current.message).toContain('尚未保存');
  if (mode === 'success') late.resolve({ ok: true, value: variant(firstView) }); else late.reject(Error('late failure'));
  await vi.advanceTimersByTimeAsync(100);
  expect(s.read()).toBe(current); expect(s.read().sceneContext?.locationRole).toBe('room');
  await s.retry(); expect(s.read()).toBe(current);
  expect(narrate).toHaveBeenCalledTimes(2); expect(readActionReceipts(engines[0]!.snapshot())).toHaveLength(2);
  expect(vi.getTimerCount()).toBe(0);
});

test('narrator timeout preserves picked inventory and allows next action with unchanged session contract', async () => {
  vi.useFakeTimers(); const engines = captureEngines();
  const options: NarrationOptions = { narrationTimeoutMs: 10, narrator: { narrate: async () => new Promise(() => {}) } };
  const s = session(createGame(world(), options));
  for (const work of [() => s.search(room), () => s.pickUp(tin), () => s.move(corridor)]) {
    const pending = work(); await vi.advanceTimersByTimeAsync(10); await pending;
    expect(s.read()).toMatchObject({ phase: 'success', canRetry: false }); expect(s.read().message).toContain('尚未保存');
  }
  expect(s.read().inventory).toEqual(projectInventory(engines[0]!.snapshot()));
  expect(s.read().inventory).toHaveLength(1); expect(s.read().clock.worldRevision).toBe(3);
  expect(s.read().sceneContext?.locationRole).toBe('corridor'); expect(s.read().entries).toHaveLength(3);
});

test('two instances and a cross-world old text remain isolated', async () => {
  const engines = captureEngines(), late = deferred(); let oldText = '';
  const a = createGame(world(), { narrator: { narrate: async v => { oldText = variant(v); return late.promise; } } });
  const pending = a.dispatch(action('observe', 0)); await Promise.resolve();
  const b = createGame(doorFixture(2976), { narrator: { narrate: async () => ({ ok: true, value: oldText }) } });
  const br = await b.dispatch(doorCommand());
  expect(br).toMatchObject({ ok: true, outcome: { summary: '你花了一分钟透过门缝观察。未能辨清门外的细节。', facts: [] } });
  late.resolve({ ok: true, value: oldText });
  expect(await pending).toMatchObject({ ok: true, outcome: { summary: oldText } });
  expect(engines[0]!.snapshot().rngState).toEqual(world().rngState);
  expect(engines[1]!.snapshot().rngState).not.toEqual(engines[0]!.snapshot().rngState);
});

test.each(doorVectors)('door seed $seed sends sensory DTO only and rejects a false safety claim', async vector => {
  let sent!: VisibleOutcome;
  const input = doorFixture(vector.seed); input.player.background = 'PRIVATE_BACKGROUND';
  input.items[tin].metadata = { secret: 'PRIVATE_GUN' };
  const baseline = await createGame(input).dispatch(doorCommand());
  const result = await createGame(input, { narrator: { narrate: async v => {
    sent = v; return { ok: true, value: v.summary + '门外无人，非常安全。' };
  } } }).dispatch(doorCommand());
  expect(result).toEqual(baseline);
  expect(JSON.stringify(sent)).not.toMatch(/PRIVATE|prototype|alertness|noticed|Roll|rng|sourceEventId|安全|暴露|概率/);
  if (baseline.ok) expect(sent).toEqual(baseline.outcome);
});
