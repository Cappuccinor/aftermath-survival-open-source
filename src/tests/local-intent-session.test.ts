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
import { projectPlayerStatus } from '../application/player-status';
import { projectInventory } from '../application/inventory';
import { projectSceneContext } from '../application/scene-context';
import type { ActionReply, GameClient, ObservationSession } from '../application/ports';
import { localIntentInterpreter } from '../adapters/ai/local-intent';
import { doorCharacter, doorMetadata } from './door-fixtures';

const originalEngine = core.createEngine;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function captureEngines() {
  const engines: ReturnType<typeof core.createEngine>[] = [];
  vi.spyOn(core, 'createEngine').mockImplementation(input => {
    const engine = originalEngine(input); engines.push(engine); return engine;
  });
  return engines;
}
function session(world: WorldState, client: GameClient, timeoutMs = 5000) {
  return createObservationSession({ client, interpreter: localIntentInterpreter, timeoutMs,
    actorId: world.player.playerId, initialClock: projectClock(world), initialLocation: projectLocation(world),
    initialRoutes: visibleRoutes(world), initialSearchTargets: visibleSearchTargets(world),
    initialTargets: visibleInspectionTargets(world), initialDoorTargets: visibleDoorTargets(world),
    initialPickupTargets: visiblePickupTargets(world), initialInventory: projectInventory(world),
    initialPlayerStatus: projectPlayerStatus(world), initialSceneContext: projectSceneContext(world) });
}
function traced(world: WorldState) {
  const game = createGame(world), commands: unknown[] = [];
  const dispatch = vi.fn((command: unknown) => { commands.push(command); return game.dispatch(command); });
  return { s: session(world, { dispatch }), commands, dispatch };
}
async function submit(s: ObservationSession, text: string) { s.setDraft(text); await s.submitText(); }
const worlds = [
  { name: 'prototype', create: () => createBuildingPrototype(35) },
  { name: 'character', create: () => createBuildingGame(doorCharacter, doorMetadata) },
];
const sequence = [
  ['我观察一下周围', '观察四周'], ['我透过门缝看一下', '观察门缝'],
  ['请搜索一下这个房间', '搜索房间'], ['检查一下这个空罐', '检查空罐'],
  ['我把空罐拿起来', '拾取空罐'], ['走到相邻的走廊', '前往走廊'],
  ['请观察一下四周', '观察四周'], ['请前往房间', '前往房间'],
  ['搜查一下这个房间', '搜索房间'], ['透过这个门缝观察一下', '观察门缝'],
  ['请前往相邻的走廊', '前往走廊'], ['我看看周围', '观察四周'],
  ['走到这个房间', '前往房间'], ['我搜查一下房间', '搜索房间'],
  ['请查看一下这个门缝', '观察门缝'], ['我走到相邻的走廊', '前往走廊'],
  ['观察一下四周。', '观察四周'], ['我前往这个房间', '前往房间'],
  ['搜索一下房间', '搜索房间'], ['请透过门缝看一下', '观察门缝'],
  ['请走到走廊', '前往走廊'], ['请原地观察', '观察四周'],
  ['走到相邻的房间', '前往房间'], ['我观察一下这个门缝', '观察门缝'],
] as const;
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

test.each(worlds)('$name: 24 real text actions equal canonical full worlds; every step reconstructs and retries every prior ID', async fixture => {
  const engines = captureEngines(), initial = fixture.create();
  const a = traced(initial), b = traced(fixture.create());
  for (const [index, [newText, canonical]] of sequence.entries()) {
    await submit(a.s, newText); await submit(b.s, canonical);
    expect(a.s.read()).toEqual(b.s.read());
    expect(a.s.read()).toMatchObject({ phase: 'success', draft: '', canRetry: false,
      clock: { worldRevision: index + 1, gameClockMinutes: index + 1 } });
    expect(a.s.read().message).toContain('尚未保存');
    const actual = engines[0]!.snapshot(), expected = engines[1]!.snapshot();
    expect(actual).toEqual(expected); // Includes all truth, events, knowledge, RNG, ownership and load.
    expect(readActionReceipts(actual)).toEqual(readActionReceipts(expected));
    expect(a.commands[index]).toMatchObject({ utterance: newText, source: 'text', commandId: `cmd-ui-${index + 1}` });
    expect({ ...a.commands[index] as object, utterance: canonical }).toEqual(b.commands[index]);
    for (const [snapshot, commands] of [[actual, a.commands], [expected, b.commands]] as const) {
      const rebuilt = originalEngine(clone(snapshot)), before = rebuilt.snapshot();
      for (const old of commands) {
        expect(rebuilt.dispatch(old)).toMatchObject({ ok: true, replayed: true });
        expect(rebuilt.snapshot()).toBe(before);
      }
      expect(rebuilt.snapshot()).toEqual(snapshot);
    }
  }
  const final = engines[0]!.snapshot();
  expect(readActionReceipts(final)).toHaveLength(24);
  expect(final.rngState).not.toEqual(initial.rngState);
  expect(final.items['prototype-tin']!.position).toEqual({ kind: 'player', id: final.player.playerId });
  expect(final.player.stats.carryWeightKg).toBe(0.05);
  expect(a.dispatch).toHaveBeenCalledTimes(24);
});

const refusals = [
  '不要搜索一下这个房间', '我准备走到相邻的走廊', '我想检查一下这个空罐', '我要把空罐拿起来',
  '如果安全就搜索一下房间', '请搜索一下这个房间？', '“搜索一下房间”',
  '搜索一下房间然后拿起空罐', '搜索一下房间。拿起空罐', '搜索一下房间\n拿起空罐',
  '悄悄走到走廊', '检查空罐三次', '不耗时搜索房间', '把两个空罐拿起来',
  '用撬棍搜索房间', '把饥饿设成0', '检查一下prototype-tin', '前往未知楼层',
  '<img src=x onerror=alert(1)>搜索一下房间', '请'.repeat(100_000) + '搜索房间',
];
test.each(refusals.map((text, index) => ({ text, index })))('refusal family $index preserves actual world, clock, history and draft then recovers', async ({ text }) => {
  const engines = captureEngines(), t = traced(worlds[0]!.create());
  await submit(t.s, '请搜索一下这个房间');
  const before = engines[0]!.snapshot(), view = t.s.read(), calls = t.dispatch.mock.calls.length;
  await submit(t.s, text);
  expect(t.s.read()).toMatchObject({ phase: 'error', draft: text, canRetry: false });
  expect(t.s.read().message).toContain('没有行动');
  expect(t.s.read()).toEqual({ ...view, phase: 'error', draft: text, message: t.s.read().message });
  expect(t.dispatch).toHaveBeenCalledTimes(calls); expect(engines[0]!.snapshot()).toBe(before);
  await submit(t.s, '请检查一下这个空罐');
  expect(t.s.read()).toMatchObject({ phase: 'success', draft: '', clock: { worldRevision: 2 } });
});

test('hidden, departed and already-owned targets cannot be reused, even after previous narrative names them', async () => {
  const engines = captureEngines(), t = traced(worlds[0]!.create());
  async function refuse(text: string) {
    const before = engines[0]!.snapshot(), count = t.dispatch.mock.calls.length, entries = t.s.read().entries;
    await submit(t.s, text);
    expect(t.s.read()).toMatchObject({ phase: 'error', draft: text });
    expect(t.s.read().entries).toBe(entries); expect(t.dispatch).toHaveBeenCalledTimes(count);
    expect(engines[0]!.snapshot()).toBe(before);
  }
  await refuse('请检查一下空罐'); await refuse('把这个空罐捡起来');
  await submit(t.s, '搜索一下房间'); await submit(t.s, '检查一下这个空罐');
  await submit(t.s, '走到相邻的走廊');
  await refuse('请检查一下空罐'); await refuse('透过门缝看一下'); await refuse('请搜索一下这个房间');
  await submit(t.s, '请前往房间'); await submit(t.s, '把这个空罐捡起来');
  await refuse('我把空罐拿起来'); await refuse('检查一下这个空罐');
  await submit(t.s, '搜索一下这个房间');
  expect(t.s.read().inventory).toHaveLength(1); expect(t.s.read().pickupTargets).toEqual([]);
  expect(engines[0]!.snapshot().player.stats.carryWeightKg).toBe(0.05);
});

test('two actual sessions interleave without sharing known targets, commands or drafts', async () => {
  const engines = captureEngines(), a = traced(worlds[0]!.create()), b = traced(worlds[1]!.create());
  await submit(a.s, '请搜索一下这个房间'); a.s.setDraft('A准备');
  await submit(b.s, '检查一下这个空罐');
  expect(b.s.read()).toMatchObject({ phase: 'error', draft: '检查一下这个空罐', clock: { worldRevision: 0 } });
  expect(a.s.read().draft).toBe('A准备');
  await submit(b.s, '请搜索一下这个房间'); await submit(a.s, '把空罐拿起来');
  expect(b.s.read().pickupTargets).toHaveLength(1);
  await submit(a.s, '请前往走廊'); await submit(b.s, '请检查一下空罐');
  expect(a.s.read().currentLocation?.label).toBe('走廊'); expect(b.s.read().currentLocation?.label).toBe('房间');
  expect(engines[0]!.snapshot().player.playerId).not.toBe(engines[1]!.snapshot().player.playerId);
  expect(engines[0]!.snapshot().items['prototype-tin']!.position.kind).toBe('player');
  expect(engines[1]!.snapshot().items['prototype-tin']!.position.kind).toBe('location');
});

test.each(['success', 'reject'] as const)('text pending/double-submit, same-ID confirmation and late %s preserve real settlement', async mode => {
  vi.useFakeTimers(); const engines = captureEngines(), w = worlds[0]!.create(), game = createGame(w);
  let resolve!: (reply: ActionReply) => void, reject!: (error: Error) => void, firstReply!: ActionReply;
  const delayed = new Promise<ActionReply>((yes, no) => { resolve = yes; reject = no; });
  const dispatch = vi.fn(async (command: unknown) => {
    const reply = await game.dispatch(command);
    if (dispatch.mock.calls.length === 1) { firstReply = reply; return delayed; }
    return reply;
  });
  const s = session(w, { dispatch }, 5);
  s.setDraft('请搜索一下这个房间'); const pending = s.submitText();
  await vi.advanceTimersByTimeAsync(0);
  expect(s.read().phase).toBe('pending'); expect(engines[0]!.snapshot().campaign.worldRevision).toBe(1);
  s.setDraft('请检查一下空罐'); await s.submitText(); await s.observe();
  expect(dispatch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(5); await pending;
  expect(s.read()).toMatchObject({ phase: 'error', canRetry: true, draft: '请检查一下空罐', clock: { worldRevision: 0 } });
  await s.submitText(); expect(dispatch).toHaveBeenCalledTimes(1);
  await s.retry(); expect(dispatch.mock.calls[1]![0]).toBe(dispatch.mock.calls[0]![0]);
  expect(s.read()).toMatchObject({ phase: 'success', canRetry: false, draft: '请检查一下空罐', clock: { worldRevision: 1 } });
  expect(s.read().entries).toHaveLength(1); await s.submitText();
  const current = s.read(); expect(current.clock.worldRevision).toBe(2);
  if (mode === 'success') resolve(firstReply); else reject(Error('late transport failure'));
  await vi.advanceTimersByTimeAsync(20); expect(s.read()).toBe(current);
  expect(readActionReceipts(engines[0]!.snapshot())).toHaveLength(2);
  expect(vi.getTimerCount()).toBe(0);
});
