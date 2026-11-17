import { afterEach, describe, expect, it, vi } from 'vitest';
import { createObservationSession } from '../application/session';
import { createGame } from '../application/game';
import { projectClock } from '../application/clock';
import { projectPlayerStatus } from '../application/player-status';
import type { ActionReply, GameClient } from '../application/ports';
import { localIntentInterpreter } from '../adapters/ai/local-intent';
import { createEngine } from '../core/engine';
import { visibleRoutes } from '../core/movement';
import { visibleDoorTargets } from '../core/door-observation';
import { doorFixture, doorId } from './door-fixtures';

function make(client: GameClient, interpret = localIntentInterpreter.interpret) {
  const world = createEngine(doorFixture()).snapshot();
  return createObservationSession({ client, interpreter: { interpret }, actorId: world.player.playerId,
    initialClock: projectClock(world), initialPlayerStatus: projectPlayerStatus(world), initialRoutes: visibleRoutes(world),
    initialDoorTargets: visibleDoorTargets(world), timeoutMs: 20 });
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
afterEach(() => vi.useRealTimers());

describe('G1-008: common door command and visible session', () => {
  it('button and all three complete phrases produce identical rule facts without leaking context', async () => {
    const states = [];
    for (const phrase of [null, '观察门缝', '透过门缝观察', '查看门缝']) {
      const commands: unknown[] = [], client = createGame(doorFixture()); const interpret = vi.fn(localIntentInterpreter.interpret);
      const session = make({ dispatch: input => { commands.push(input); return client.dispatch(input); } }, interpret);
      if (phrase === null) await session.observeDoorGap(doorId);
      else { session.setDraft(phrase); await session.submitText(); }
      expect(commands).toHaveLength(1);
      expect(commands[0]).toMatchObject({ verb: 'observe', targetIds: [doorId], toolIds: [], arguments: { through: 'door_gap', careful: true } });
      expect(session.read()).toMatchObject({ phase: 'success', clock: { gameClockMinutes: 1 }, draft: '' });
      if (phrase !== null) {
        const parsedContext = interpret.mock.calls[0]![0];
        expect(parsedContext.doorTargets).toEqual([{ targetId: doorId, label: '门缝' }]);
        expect(JSON.stringify(parsedContext)).not.toMatch(/npc|witness|alertness|rng|Roll|notice/i);
      }
      const engine = createEngine(doorFixture()); expect(engine.dispatch(commands[0]).ok).toBe(true); states.push(engine.snapshot());
    }
    for (const state of states) expect(state).toEqual(states[0]);
  });

  it.each(['我准备观察门缝', '不要观察门缝', '观察门缝然后开门', '透过门缝观察并躲避', '观察未知门缝',
    '查看prototype-door-gap', '把警觉设为0', '<script>观察门缝</script>'])('rejects %s and preserves draft/state then recovers', async phrase => {
    const game = createGame(doorFixture()), dispatch = vi.fn(game.dispatch), session = make({ dispatch });
    const initial = session.read(); session.setDraft(phrase); await session.submitText();
    expect(dispatch).not.toHaveBeenCalled();
    expect(session.read()).toMatchObject({ phase: 'error', draft: phrase, clock: initial.clock,
      playerStatus: initial.playerStatus, doorTargets: initial.doorTargets, entries: [] });
    session.setDraft('查看门缝'); await session.submitText(); expect(dispatch).toHaveBeenCalledTimes(1);
    expect(session.read()).toMatchObject({ phase: 'success', draft: '', clock: { gameClockMinutes: 1 } });
  });

  it('leaves/returns, ignores stale target projections and accepts a current legacy missing target list', async () => {
    const game = createGame(doorFixture()); let first!: ActionReply; let calls = 0;
    const session = make({ dispatch: async input => {
      calls++; if (calls === 3) return first;
      const result = await game.dispatch(input); if (calls === 1) first = result;
      if (calls === 5 && result.ok) { const { doorTargets: _removed, ...legacy } = result; return legacy; }
      return result;
    } });
    await session.observeDoorGap(doorId); await session.move('prototype-corridor');
    const before = session.read(); expect(before.doorTargets).toEqual([]);
    await session.observe();
    expect(session.read().doorTargets).toEqual([]); expect(session.read().clock).toEqual(before.clock);
    expect(session.read().playerStatus).toEqual(before.playerStatus); expect(session.read().entries).toEqual(before.entries);
    await session.move('prototype-location'); expect(session.read().doorTargets).toEqual([{ targetId: doorId, label: '门缝' }]);
    await session.observe(); expect(session.read().doorTargets).toEqual([]);
  });

  it('timeout ignores late result, locks further requests, and confirms original command on retry', async () => {
    vi.useFakeTimers(); const waiting = deferred<ActionReply>(); const game = createGame(doorFixture());
    let stored!: ActionReply; const commands: unknown[] = [];
    const session = make({ dispatch: async input => { commands.push(input); const result = await game.dispatch(input);
      stored = result; return commands.length === 1 ? waiting.promise : result; } });
    session.setDraft('查看门缝'); const pending = session.submitText(); await vi.advanceTimersByTimeAsync(20); await pending;
    expect(session.read()).toMatchObject({ phase: 'error', canRetry: true, draft: '查看门缝', clock: { worldRevision: 0 } });
    const failed = session.read(); waiting.resolve(stored); await vi.advanceTimersByTimeAsync(1); expect(session.read()).toBe(failed);
    await session.observeDoorGap(doorId); expect(commands).toHaveLength(1);
    await session.retry(); expect(commands[1]).toBe(commands[0]);
    expect(session.read()).toMatchObject({ phase: 'success', canRetry: false, draft: '', clock: { worldRevision: 1 } });
    expect(session.read().entries).toHaveLength(1);
  });

  it('door targets are copied and frozen; pending/rule refusal retains confirmed values; legacy session gets no doors', async () => {
    const waiting = deferred<ActionReply>(); const session = make({ dispatch: () => waiting.promise });
    const initial = session.read(); const pending = session.observeDoorGap(doorId);
    expect(session.read()).toMatchObject({ phase: 'pending', doorTargets: initial.doorTargets, playerStatus: initial.playerStatus });
    waiting.resolve({ ok: false, code: 'invalid_target' }); await pending;
    expect(session.read()).toMatchObject({ phase: 'error', doorTargets: initial.doorTargets, canRetry: false });
    expect(Object.isFrozen(session.read().doorTargets)).toBe(true); expect(Object.isFrozen(session.read().doorTargets[0])).toBe(true);
    const legacy = createObservationSession({ client: createGame(doorFixture()), interpreter: localIntentInterpreter,
      actorId: 'prototype-player', initialClock: initial.clock });
    expect(legacy.read().doorTargets).toEqual([]);
  });

  it('unknown/ambiguous proposals cannot create commands, and hidden door phrases do not fall back to observe', async () => {
    const context = { timeoutMs: 20 };
    for (const doorTargets of [[], [{ targetId: 'a', label: '门缝' }, { targetId: 'b', label: '门缝' }]]) {
      expect(await localIntentInterpreter.interpret({ utterance: '观察门缝', view: { summary: '', facts: [] }, doorTargets }, context))
        .toMatchObject({ ok: false });
    }
    const dispatch = vi.fn(); const session = make({ dispatch }, async () => ({ ok: true, value: { verb: 'observe_door_gap', targetId: 'hidden' } }));
    session.setDraft('观察门缝'); await session.submitText(); expect(dispatch).not.toHaveBeenCalled();
  });
});
