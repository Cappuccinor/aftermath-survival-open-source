import { afterEach, expect, test, vi } from 'vitest';
import * as core from '../core/engine';
import type { WorldState } from '../core/world';
import { readActionReceipts } from '../core/receipts';
import { createBuildingGame, createBuildingPrototype } from '../core/building-prototype';
import { projectLocation, visibleRoutes } from '../core/movement';
import { visibleSearchTargets } from '../core/search';
import { visibleInspectionTargets } from '../core/inspection';
import { visibleDoorTargets } from '../core/door-observation';
import { visiblePickupTargets } from '../core/pickup';
import { createGame } from '../application/game';
import { createObservationSession } from '../application/session';
import { projectClock } from '../application/clock';
import { projectInventory } from '../application/inventory';
import { projectPlayerStatus } from '../application/player-status';
import { projectSceneContext } from '../application/scene-context';
import type { ActionReply, GameClient, ObservationSession, PortResult } from '../application/ports';
import type { IntentInterpreter } from '../adapters/ai/ports';
import { localIntentInterpreter } from '../adapters/ai/local-intent';
import { doorCharacter, doorMetadata } from './door-fixtures';

const originalEngine = core.createEngine;
const proposal = { kind: 'unsupported_intent', verb: 'attack' };
const feedback = '已识别为攻击意图，但当前尚未实现攻击。本次没有行动。输入已保留，可修改后重试。';
const declarations = ['我精准击杀他', '我杀了他', '我要杀死他', '我要杀死NPC', '攻击他', '我攻击他', '攻击NPC'];
const worlds = [{ name: 'prototype', create: () => createBuildingPrototype(35) },
  { name: 'character', create: () => createBuildingGame(doorCharacter, doorMetadata) }];
function capture() {
  const engines: ReturnType<typeof core.createEngine>[] = [];
  vi.spyOn(core, 'createEngine').mockImplementation(input => { const e = originalEngine(input); engines.push(e); return e; });
  return engines;
}
function session(w: WorldState, client: GameClient, interpreter = localIntentInterpreter, timeoutMs = 5000) {
  return createObservationSession({ client, interpreter, timeoutMs, actorId: w.player.playerId, initialClock: projectClock(w),
    initialLocation: projectLocation(w), initialRoutes: visibleRoutes(w), initialTargets: visibleInspectionTargets(w),
    initialDoorTargets: visibleDoorTargets(w), initialSearchTargets: visibleSearchTargets(w), initialPickupTargets: visiblePickupTargets(w),
    initialInventory: projectInventory(w), initialPlayerStatus: projectPlayerStatus(w), initialSceneContext: projectSceneContext(w) });
}
function setup(w = worlds[0]!.create(), interpreter = localIntentInterpreter) {
  const game = createGame(w), dispatch = vi.fn(game.dispatch); return { s: session(w, { dispatch }, interpreter), dispatch };
}
const submit = async (s: ObservationSession, draft: string) => { s.setDraft(draft); await s.submitText(); };
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

test.each(worlds)('$name: attack declarations preserve complete actual world, every projection/history and command IDs before and after actions', async fixture => {
  const engines = capture(), t = setup(fixture.create());
  async function unchanged() {
    for (const text of declarations) {
      const before = engines[0]!.snapshot(), receipts = readActionReceipts(before), calls = t.dispatch.mock.calls.length, view = t.s.read();
      await submit(t.s, text);
      expect(t.s.read()).toEqual({ ...view, phase: 'error', message: feedback, draft: text, canRetry: false });
      expect(t.dispatch).toHaveBeenCalledTimes(calls); expect(engines[0]!.snapshot()).toBe(before);
      expect(readActionReceipts(engines[0]!.snapshot())).toEqual(receipts);
      await t.s.retry(); expect(t.dispatch).toHaveBeenCalledTimes(calls);
    }
  }
  await unchanged();
  for (const text of ['请搜索一下这个房间', '我透过门缝看一下', '把这个空罐捡起来', '走到相邻的走廊']) {
    await submit(t.s, text); expect(t.s.read().phase).toBe('success'); await unchanged();
  }
  await submit(t.s, '请前往房间');
  expect(t.s.read()).toMatchObject({ phase: 'success', draft: '', clock: { worldRevision: 5 }, inventory: [{ count: 1, weightKg: 0.05 }] });
  expect(t.dispatch.mock.calls.map(call => (call[0] as { commandId: string }).commandId)).toEqual(['cmd-ui-1', 'cmd-ui-2', 'cmd-ui-3', 'cmd-ui-4', 'cmd-ui-5']);
});

const invalidFactories: [string, () => unknown][] = [
  ['target', () => ({ ...proposal, targetId: 'prototype-witness' })], ['damage', () => ({ ...proposal, damage: 100 })],
  ['success', () => ({ ...proposal, success: true })], ['world', () => ({ ...proposal, worldState: { hp: 0 } })],
  ['foreign', () => ({ ...proposal, targetId: 'another-world-npc' })], ['wrong kind', () => ({ ...proposal, kind: 'execute' })],
  ['wrong verb', () => ({ ...proposal, verb: 'observe' })], ['attack alone', () => ({ verb: 'attack' })],
  ['missing verb', () => ({ kind: 'unsupported_intent' })], ['array', () => Object.assign([], proposal)],
  ['null', () => null], ['string', () => 'attack'], ['inherited', () => Object.create(proposal)],
  ['custom prototype', () => Object.assign(Object.create({ extra: true }), proposal)],
  ['null prototype', () => Object.assign(Object.create(null), proposal)],
  ['nonenumerable extra', () => Object.defineProperty({ ...proposal }, 'damage', { value: 100 })],
  ['symbol', () => ({ ...proposal, [Symbol('damage')]: 100 })],
  ['prototype trap', () => new Proxy(proposal, { getPrototypeOf() { throw Error('trap'); } })],
  ['keys trap', () => new Proxy(proposal, { ownKeys() { throw Error('trap'); } })],
  ['descriptor trap', () => new Proxy(proposal, { getOwnPropertyDescriptor() { throw Error('trap'); } })],
];
test.each(invalidFactories)('rejects malformed non-executing record %s without dispatch or world changes', async (_name, create) => {
  const engines = capture(); let first = true;
  const interpreter: IntentInterpreter = { interpret: async (...args) => {
    if (first) { first = false; return { ok: true, value: create() }; }
    return localIntentInterpreter.interpret(...args);
  } };
  const t = setup(worlds[0]!.create(), interpreter), before = engines[0]!.snapshot();
  await submit(t.s, '我杀了他');
  expect(t.s.read()).toMatchObject({ phase: 'error', draft: '我杀了他', canRetry: false });
  expect(t.s.read().message).not.toBe(feedback); expect(t.dispatch).not.toHaveBeenCalled(); expect(engines[0]!.snapshot()).toBe(before);
  await submit(t.s, '请观察一下四周'); expect(t.s.read().phase).toBe('success');
  expect(t.dispatch.mock.calls[0]![0]).toMatchObject({ commandId: 'cmd-ui-1' });
});

test.each(['kind', 'verb', 'executable-verb', 'targetId'] as const)('never invokes untrusted %s accessor or turns it into a command', async field => {
  const engines = capture(), getter = vi.fn(() => field === 'kind' ? 'unsupported_intent' : field === 'targetId' ? 'prototype-location' : 'observe');
  const value = field === 'executable-verb' ? {} : field === 'targetId' ? { verb: 'search' } : { ...proposal };
  Object.defineProperty(value, field === 'executable-verb' ? 'verb' : field, { get: getter, enumerable: true });
  const t = setup(worlds[0]!.create(), { interpret: async () => ({ ok: true, value }) }), before = engines[0]!.snapshot();
  await submit(t.s, '我杀了他');
  expect(t.s.read().phase).toBe('error'); expect(getter).not.toHaveBeenCalled();
  expect(t.dispatch).not.toHaveBeenCalled(); expect(engines[0]!.snapshot()).toBe(before);
});

test('strict frozen and nonenumerable own-data unsupported records remain non-executing', async () => {
  const engines = capture();
  const data = Object.create(Object.prototype, { kind: { value: 'unsupported_intent' }, verb: { value: 'attack' } });
  for (const value of [Object.freeze({ ...proposal }), data]) {
    const t = setup(worlds[0]!.create(), { interpret: async () => ({ ok: true, value }) }), engine = engines.at(-1)!, before = engine.snapshot();
    await submit(t.s, '我杀了他'); expect(t.s.read().message).toBe(feedback);
    expect(t.dispatch).not.toHaveBeenCalled(); expect(engine.snapshot()).toBe(before);
  }
});

test('pending classification preserves edited draft, blocks duplicate submits and permits a fresh real action', async () => {
  const engines = capture(), wait = deferred<PortResult<unknown>>(); let first = true;
  const t = setup(worlds[0]!.create(), { interpret: (...args) => {
    if (first) { first = false; return wait.promise; } return localIntentInterpreter.interpret(...args);
  } });
  t.s.setDraft('我杀了他'); const pending = t.s.submitText(); t.s.setDraft('请搜索一下这个房间');
  await t.s.submitText(); await t.s.observe(); await t.s.retry(); expect(t.s.read().phase).toBe('pending');
  wait.resolve({ ok: true, value: proposal }); await pending;
  expect(t.s.read()).toMatchObject({ phase: 'error', message: feedback, draft: '请搜索一下这个房间', canRetry: false });
  expect(t.dispatch).not.toHaveBeenCalled(); expect(engines[0]!.snapshot().campaign.worldRevision).toBe(0);
  await t.s.submitText(); expect(t.s.read().clock.worldRevision).toBe(1);
});

test.each(['success', 'reject'] as const)('timed-out classification consumes late %s without overwriting a recovered action', async mode => {
  vi.useFakeTimers(); const engines = capture(), w = worlds[0]!.create(), game = createGame(w), dispatch = vi.fn(game.dispatch);
  const wait = deferred<PortResult<unknown>>(); let first = true, signal: AbortSignal | undefined;
  const s = session(w, { dispatch }, { interpret: (...args) => {
    if (first) { first = false; signal = args[1].signal; return wait.promise; } return localIntentInterpreter.interpret(...args);
  } }, 5);
  s.setDraft('我杀了他'); const pending = s.submitText(); await vi.advanceTimersByTimeAsync(5); await pending;
  expect(signal?.aborted).toBe(true); expect(s.read()).toMatchObject({ phase: 'error', canRetry: false, draft: '我杀了他' });
  expect(dispatch).not.toHaveBeenCalled(); await submit(s, '请搜索一下这个房间'); const current = s.read();
  if (mode === 'success') wait.resolve({ ok: true, value: proposal }); else wait.reject(Error('late parse failure'));
  await vi.advanceTimersByTimeAsync(20); expect(s.read()).toBe(current);
  expect(engines[0]!.snapshot().campaign.worldRevision).toBe(1); expect(vi.getTimerCount()).toBe(0);
});

test('unsupported text cannot replace an uncertain command or bypass same-ID confirmation', async () => {
  vi.useFakeTimers(); const engines = capture(), w = worlds[0]!.create(), game = createGame(w), wait = deferred<ActionReply>(); let stored!: ActionReply;
  const dispatch = vi.fn(async (input: unknown) => { const reply = await game.dispatch(input); if (dispatch.mock.calls.length === 1) { stored = reply; return wait.promise; } return reply; });
  const interpret = vi.fn(localIntentInterpreter.interpret), s = session(w, { dispatch }, { interpret }, 5);
  s.setDraft('请搜索一下房间'); const pending = s.submitText(); await vi.advanceTimersByTimeAsync(5); await pending;
  s.setDraft('我精准击杀他'); await s.submitText(); expect(interpret).toHaveBeenCalledTimes(1);
  expect(s.read().canRetry).toBe(true); await s.retry(); expect(dispatch.mock.calls[1]![0]).toBe(dispatch.mock.calls[0]![0]);
  expect(s.read().draft).toBe('我精准击杀他'); const before = engines[0]!.snapshot();
  await s.submitText(); const classified = s.read(); expect(classified.message).toBe(feedback);
  expect(dispatch).toHaveBeenCalledTimes(2); expect(engines[0]!.snapshot()).toBe(before);
  wait.resolve(stored); await vi.advanceTimersByTimeAsync(20); expect(s.read()).toBe(classified);
  await submit(s, '请观察一下四周'); expect(s.read().clock.worldRevision).toBe(2);
  expect(vi.getTimerCount()).toBe(0);
});

test('different sessions keep their actual targets and drafts; classification reveals no identity or foreign state', async () => {
  const engines = capture(), a = setup(worlds[0]!.create()), b = setup(worlds[1]!.create());
  await submit(a.s, '搜索一下房间'); await submit(a.s, '把空罐拿起来'); await submit(b.s, '请前往走廊');
  const aw = engines[0]!.snapshot(), bw = engines[1]!.snapshot();
  await submit(a.s, '我精准击杀他'); await submit(b.s, '我要杀死NPC');
  expect(a.s.read().message).toBe(feedback); expect(b.s.read().message).toBe(feedback);
  expect(a.s.read().draft).toBe('我精准击杀他'); expect(b.s.read().draft).toBe('我要杀死NPC');
  expect(a.s.read().message).not.toMatch(/prototype|created-player|警觉|击杀成功|击杀失败|目标不存在/);
  expect(engines[0]!.snapshot()).toBe(aw); expect(engines[1]!.snapshot()).toBe(bw);
  await submit(a.s, '我准备攻击他'); expect(a.s.read().message).not.toBe(feedback);
  await submit(a.s, '攻击他然后拿起空罐'); expect(a.s.read().message).not.toBe(feedback);
  await submit(a.s, '请观察一下四周'); expect(a.s.read().phase).toBe('success');
  expect(engines[1]!.snapshot()).toBe(bw);
});
