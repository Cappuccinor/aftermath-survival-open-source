import { afterEach, describe, expect, it, vi } from 'vitest';
import { createObservationSession } from '../application/session';
import { projectClock } from '../application/clock';
import { createGame } from '../application/game';
import { createEngine } from '../core/engine';
import { localIntentInterpreter } from '../adapters/ai/local-intent';
import type { IntentInterpreter } from '../adapters/ai/ports';
import type { ActionReply, GameClient, VisibleClock } from '../application/ports';
import { scene } from './observe-fixtures';

const initialClock: VisibleClock = Object.freeze({ worldRevision: 0, gameClockMinutes: 0, label: '生存第 1 天 · 08:00 · 灾变第 30 天' });
function make(client: GameClient = createGame(scene()), interpreter: IntentInterpreter = localIntentInterpreter) {
  return createObservationSession({ client, interpreter, actorId: 'player-1', initialClock, timeoutMs: 50 });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
afterEach(() => vi.useRealTimers());

describe('G1-002: trusted clock projection', () => {
  it('derives the exact two-day clock from authoritative minutes across midnight', () => {
    const input = scene();
    input.campaign.gameClockMinutes = 960; input.campaign.worldRevision = 3;
    expect(projectClock(input)).toEqual({ worldRevision: 3, gameClockMinutes: 960, label: '生存第 2 天 · 00:00 · 灾变第 31 天' });
    expect(Object.keys(projectClock(input)).sort()).toEqual(['gameClockMinutes', 'label', 'worldRevision']);
    expect(Object.isFrozen(projectClock(input))).toBe(true);
  });
});

describe('G1-002: observable interaction session', () => {
  it('starts idle, commits a button observation, then an equivalent text observation with truthful unsaved feedback', async () => {
    const session = make();
    expect(session.read()).toMatchObject({ phase: 'idle', clock: initialClock, entries: [], canRetry: false });
    await session.observe();
    expect(session.read()).toMatchObject({ phase: 'success', clock: { gameClockMinutes: 1, worldRevision: 1 }, canRetry: false });
    expect(session.read().message).toContain('尚未保存');
    session.setDraft('看看周围'); await session.submitText();
    expect(session.read()).toMatchObject({ phase: 'success', draft: '', clock: { gameClockMinutes: 2, worldRevision: 2 } });
    expect(session.read().entries).toHaveLength(2);
    expect(Object.isFrozen(session.read())).toBe(true);
    expect(Object.isFrozen(session.read().entries)).toBe(true);
  });

  it.each(['', '我准备离开', '不要观察四周', '先观察再离开', '把饥饿设成0', '观察门缝', '<script>观察四周</script>'])('rejects %j without dispatch, clock, narrative or draft loss; the next valid attempt works', async draft => {
    const game = createGame(scene()); const dispatch = vi.fn(game.dispatch);
    const session = make({ dispatch }); session.setDraft(draft);
    await session.submitText();
    expect(dispatch).not.toHaveBeenCalled();
    expect(session.read()).toMatchObject({ phase: 'error', draft, clock: initialClock, entries: [], canRetry: false });
    session.setDraft('原地观察'); await session.submitText();
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(session.read().clock.worldRevision).toBe(1);
  });

  it('buttons and equivalent text issue the same rule inputs and produce identical full world facts', async () => {
    const commands: unknown[] = [];
    for (const button of [true, false]) {
      const game = createGame(scene(1));
      const session = make({ dispatch: async input => { commands.push(input); return game.dispatch(input); } });
      if (button) await session.observe();
      else { session.setDraft('看看周围'); await session.submitText(); }
    }
    expect(commands).toHaveLength(2);
    const states = commands.map(command => { const core = createEngine(scene(1)); expect(core.dispatch(command).ok).toBe(true); return core.snapshot(); });
    expect(states[0]).toEqual(states[1]);
    expect(states[0]!.eventJournal).toHaveLength(2);
  });

  it('locks immediately during interpretation and execution, preserves a newly edited draft, and sends only once', async () => {
    const waiting = deferred<ActionReply>(); const dispatch = vi.fn((_input: unknown) => waiting.promise);
    const session = make({ dispatch }); session.setDraft('看看周围');
    const pending = session.submitText();
    expect(session.read().phase).toBe('pending');
    await session.observe(); await session.submitText(); await session.retry();
    session.setDraft('我准备离开');
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1));
    const real = await createGame(scene()).dispatch(dispatch.mock.calls[0]![0]);
    waiting.resolve(real); await pending;
    expect(session.read()).toMatchObject({ phase: 'success', draft: '我准备离开', clock: { gameClockMinutes: 1 } });
    expect(session.read().entries).toHaveLength(1);
  });

  it('a rule rejection retains committed narrative and draft, then allows a fresh successful action', async () => {
    const game = createGame(scene()); let calls = 0;
    const session = make({ dispatch: input => ++calls === 2 ? Promise.resolve({ ok: false, code: 'settlement_failed' }) : game.dispatch(input) });
    await session.observe(); const before = session.read();
    session.setDraft('看看周围'); await session.submitText();
    expect(session.read()).toMatchObject({ phase: 'error', draft: '看看周围', canRetry: false });
    expect(session.read().clock).toEqual(before.clock); expect(session.read().entries).toEqual(before.entries);
    await session.submitText();
    expect(session.read().clock.worldRevision).toBe(2);
  });

  it('retries an uncertain committed action with the exact same ID/revision and never doubles settlement', async () => {
    const game = createGame(scene()); const seen: unknown[] = [];
    const session = make({ dispatch: async input => { seen.push(input); const result = await game.dispatch(input); if (seen.length === 1) throw new Error('lost reply'); return result; } });
    session.setDraft('看看周围'); await session.submitText();
    expect(session.read()).toMatchObject({ phase: 'error', canRetry: true, draft: '看看周围', clock: initialClock });
    await session.observe(); await session.submitText(); expect(seen).toHaveLength(1);
    await session.retry(); expect(seen[1]).toEqual(seen[0]);
    expect(session.read()).toMatchObject({ phase: 'success', canRetry: false, clock: { gameClockMinutes: 1 } });
    expect(session.read().entries).toHaveLength(1);
    await session.retry(); expect(seen).toHaveLength(2);
    await session.observe(); expect(session.read().clock.gameClockMinutes).toBe(2);
  });

  it('timeout has one call, late result cannot overwrite UI, and explicit retry confirms the original action', async () => {
    vi.useFakeTimers();
    const waiting = deferred<ActionReply>(); const game = createGame(scene());
    let stored!: ActionReply; let calls = 0;
    const session = make({ dispatch: async input => { calls++; stored = await game.dispatch(input); return calls === 1 ? waiting.promise : stored; } });
    const pending = session.observe(); await vi.advanceTimersByTimeAsync(50); await pending;
    expect(session.read()).toMatchObject({ phase: 'error', canRetry: true, clock: initialClock }); expect(calls).toBe(1);
    const failed = session.read(); waiting.resolve(stored); await vi.advanceTimersByTimeAsync(1);
    expect(session.read()).toBe(failed);
    await session.retry(); expect(calls).toBe(2);
    expect(session.read().clock.worldRevision).toBe(1); expect(session.read().entries).toHaveLength(1);
  });

  it('old receipts cannot roll back the clock or append duplicate narrative, even after the visible history is trimmed', async () => {
    const game = createGame(scene()); let first!: ActionReply; let calls = 0;
    const session = make({ dispatch: async input => { calls++; if (calls === 5) return first; const result = await game.dispatch(input); if (calls === 1) first = result; return result; } });
    for (let i = 0; i < 4; i++) await session.observe();
    const before = session.read(); expect(before.entries).toHaveLength(3);
    await session.observe();
    expect(session.read().clock).toEqual(before.clock); expect(session.read().entries).toEqual(before.entries);
    await session.observe(); expect(session.read().clock.worldRevision).toBe(5);
  });

  it.each(['throw', 'invalid', 'timeout'])('parser %s retains draft and does not consume a command', async mode => {
    vi.useFakeTimers(); let calls = 0;
    const interpreter: IntentInterpreter = { interpret: async (...args) => {
      calls++; if (calls > 1) return localIntentInterpreter.interpret(...args);
      if (mode === 'throw') throw new Error('parse unavailable');
      if (mode === 'invalid') return { ok: true, value: { verb: 'observe', worldState: { hp: 0 } } };
      return new Promise(() => {});
    } };
    const game = createGame(scene()); const dispatch = vi.fn(game.dispatch); const session = make({ dispatch }, interpreter);
    session.setDraft('看看周围'); const pending = session.submitText(); await vi.advanceTimersByTimeAsync(50); await pending;
    expect(dispatch).not.toHaveBeenCalled();
    expect(session.read()).toMatchObject({ phase: 'error', canRetry: false, draft: '看看周围', clock: initialClock });
    await session.submitText(); expect(session.read().clock.worldRevision).toBe(1);
  });

  it('isolates two delayed instances and unsubscribed listeners', async () => {
    const wait = deferred<ActionReply>(); const game = createGame(scene()); let input: unknown;
    const a = make({ dispatch: command => { input = command; return wait.promise; } }); const b = make();
    const listener = vi.fn(); const unsubscribe = a.subscribe(listener); unsubscribe(); listener.mockClear();
    const pending = a.observe(); await b.observe(); expect(a.read().phase).toBe('pending');
    wait.resolve(await game.dispatch(input)); await pending;
    expect(a.read().clock.worldRevision).toBe(1); expect(b.read().clock.worldRevision).toBe(1);
    expect(a.read().entries).toHaveLength(1); expect(b.read().entries).toHaveLength(1); expect(listener).not.toHaveBeenCalled();
  });
});
