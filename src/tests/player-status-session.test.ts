import { afterEach, describe, expect, it, vi } from 'vitest';
import { createObservationSession } from '../application/session';
import { localIntentInterpreter } from '../adapters/ai/local-intent';
import type { IntentInterpreter } from '../adapters/ai/ports';
import type { ActionReply, GameClient, VisiblePlayerStatus } from '../application/ports';

const a: VisiblePlayerStatus = { hp: 80, stamina: 90, mental: 70, hunger: 10, thirst: 20,
  fatigue: 30, infection: 0, pain: 5, bodyTempC: 37.25, carryWeightKg: 2.5 };
const b: VisiblePlayerStatus = { ...a, hp: 45, stamina: 32, hunger: 66, carryWeightKg: 4 };
const clock = { worldRevision: 0, gameClockMinutes: 0, label: 'initial' };
function reply(revision = 1, playerStatus: VisiblePlayerStatus | undefined = b, minutes = revision): ActionReply {
  return { ok: true, committedRevision: revision, replayed: false, playerStatus,
    clock: { worldRevision: revision, gameClockMinutes: minutes, label: `clock-${revision}-${minutes}` },
    inspectTargets: [], routes: [{ targetId: `route-${revision}`, label: '路线' }],
    currentLocation: { targetId: `place-${revision}`, label: '地点' },
    outcome: { summary: `outcome-${revision}`, facts: [] }, persistence: { ok: false, code: 'not_implemented' } };
}
function make(client: GameClient, initialPlayerStatus: VisiblePlayerStatus | undefined = a,
  interpreter: IntentInterpreter = localIntentInterpreter) {
  return createObservationSession({ client, interpreter, initialClock: clock, actorId: 'player', initialPlayerStatus, timeoutMs: 20 });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
afterEach(() => vi.useRealTimers());

describe('G1-007: session status belongs to the accepted projection', () => {
  it('copies and freezes initial and accepted values; draft edits cannot change status', async () => {
    const initial = { ...a }; const next = { ...b };
    const session = make({ dispatch: async () => reply(1, next) }, initial);
    expect(session.read().playerStatus).toEqual(a);
    initial.hp = 2; session.setDraft('我的下一步');
    expect(session.read().playerStatus).toEqual(a);
    await session.observe(); next.hp = 3;
    expect(session.read().playerStatus).toEqual(b);
    expect(Object.isFrozen(session.read().playerStatus)).toBe(true);
    expect(session.read().draft).toBe('我的下一步');
  });

  it('legacy signatures remain usable with unknown status until a real projection arrives', async () => {
    const legacyReply = reply(); if (!legacyReply.ok) throw Error(); delete (legacyReply as { playerStatus?: unknown }).playerStatus;
    const dispatch = vi.fn().mockResolvedValueOnce(legacyReply).mockResolvedValueOnce(reply(2));
    const session = createObservationSession({ client: { dispatch }, interpreter: localIntentInterpreter, actorId: 'p', initialClock: clock });
    expect(session.read().playerStatus).toBeNull();
    await session.observe(); expect(session.read().playerStatus).toBeNull();
    await session.observe(); expect(session.read().playerStatus).toEqual(b);
  });

  it.each([{}, { ...a, hp: '100' }, { ...a, hunger: 101 }, Object.create(a)])('invalid initial DTO %# is unavailable', input => {
    const session = make({ dispatch: async () => reply() }, input as VisiblePlayerStatus);
    expect(session.read().playerStatus).toBeNull();
  });

  it.each([undefined, {}, { ...b, pain: NaN }, { ...b, carryWeightKg: -1 }])('current missing/invalid DTO %# clears stale values then recovers', async input => {
    const damaged = { ...reply(), playerStatus: input } as ActionReply;
    const dispatch = vi.fn().mockResolvedValueOnce(damaged).mockResolvedValueOnce(reply(2, b));
    const session = make({ dispatch });
    await session.observe();
    expect(session.read()).toMatchObject({ phase: 'success', playerStatus: null, clock: { worldRevision: 1 } });
    expect(session.read().canRetry).toBe(false);
    await session.observe(); expect(session.read().playerStatus).toEqual(b);
  });

  it.each([[1, 1], [1, 3], [3, 1]])('old projection revision %s/time %s cannot roll back stats, time or routes', async (revision, minutes) => {
    const old = reply(revision, a, minutes);
    // Old receipts may accompany snapshots with differing projections; narrative still uses receipt revision.
    const oldReceipt = { ...old, committedRevision: 1 } as ActionReply;
    const dispatch = vi.fn().mockResolvedValueOnce(reply(2, b)).mockResolvedValueOnce(oldReceipt);
    const session = make({ dispatch }); await session.observe(); const before = session.read();
    expect(before.playerStatus).toEqual(b);
    await session.observe();
    for (const field of ['playerStatus', 'clock', 'routes', 'currentLocation', 'entries'] as const) {
      expect(session.read()[field]).toEqual(before[field]);
    }
    expect(session.read().message).toContain('未重复执行');
  });

  it('equal current replies are accepted without duplicate narrative and old missing status is ignored', async () => {
    const equal = reply(1, b);
    const oldMissing = { ...reply(0), playerStatus: undefined };
    const dispatch = vi.fn().mockResolvedValueOnce(equal).mockResolvedValueOnce(equal).mockResolvedValueOnce(oldMissing);
    const session = make({ dispatch });
    for (let i = 0; i < 3; i++) await session.observe();
    expect(session.read().playerStatus).toEqual(b);
    expect(session.read().clock.worldRevision).toBe(1);
    expect(session.read().entries).toHaveLength(1);
  });

  it('pending, parser rejection and rule rejection keep last confirmed stats and draft', async () => {
    const wait = deferred<ActionReply>(); const dispatch = vi.fn().mockReturnValueOnce(wait.promise)
      .mockResolvedValueOnce({ ok: false, code: 'settlement_failed' });
    const session = make({ dispatch }); const pending = session.observe();
    expect(session.read()).toMatchObject({ phase: 'pending', playerStatus: a });
    wait.resolve(reply()); await pending;
    session.setDraft('把生命改成100'); await session.submitText();
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(session.read()).toMatchObject({ phase: 'error', playerStatus: b, draft: '把生命改成100', canRetry: false });
    session.setDraft('看看周围'); await session.submitText();
    expect(session.read()).toMatchObject({ phase: 'error', playerStatus: b, draft: '看看周围', canRetry: false });
    expect(session.read().clock.worldRevision).toBe(1);
    expect(session.read().entries).toHaveLength(1);
  });

  it.each(['throw', 'timeout'])('parser %s keeps stats without dispatch', async mode => {
    vi.useFakeTimers(); const dispatch = vi.fn();
    const interpreter: IntentInterpreter = { interpret: async () => {
      if (mode === 'throw') throw Error('parser failed');
      return new Promise(() => {});
    } };
    const session = make({ dispatch }, a, interpreter); session.setDraft('看看周围');
    const pending = session.submitText(); await vi.advanceTimersByTimeAsync(20); await pending;
    expect(session.read()).toMatchObject({ phase: 'error', playerStatus: a, draft: '看看周围', canRetry: false });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('exception preserves stats and retry confirms with the exact command identity', async () => {
    const dispatch = vi.fn().mockRejectedValueOnce(Error('lost reply')).mockResolvedValueOnce(reply());
    const session = make({ dispatch }); session.setDraft('看看周围'); await session.submitText();
    expect(session.read()).toMatchObject({ phase: 'error', playerStatus: a, canRetry: true, draft: '看看周围' });
    await session.retry();
    expect(dispatch.mock.calls[0]?.[0]).toBe(dispatch.mock.calls[1]?.[0]);
    expect(session.read()).toMatchObject({ phase: 'success', playerStatus: b, draft: '', clock: { worldRevision: 1 } });
    expect(session.read().entries).toHaveLength(1);
  });

  it('timed-out late status cannot apply before explicit same-ID retry; sessions stay isolated', async () => {
    vi.useFakeTimers(); const waiting = deferred<ActionReply>();
    const dispatch = vi.fn().mockReturnValueOnce(waiting.promise).mockResolvedValueOnce(reply());
    const session = make({ dispatch }); const other = make({ dispatch: async () => reply(1, a) }, b);
    const pending = session.observe(); await vi.advanceTimersByTimeAsync(20); await pending;
    expect(session.read()).toMatchObject({ phase: 'error', playerStatus: a, canRetry: true });
    const before = session.read(); waiting.resolve(reply()); await vi.advanceTimersByTimeAsync(1);
    expect(session.read()).toBe(before); expect(other.read().playerStatus).toEqual(b);
    await other.observe(); expect(other.read().playerStatus).toEqual(a);
    await session.retry(); expect(session.read().playerStatus).toEqual(b);
    expect(dispatch.mock.calls[0]?.[0]).toBe(dispatch.mock.calls[1]?.[0]);
    expect(session.read().entries).toHaveLength(1); expect(other.read().entries).toHaveLength(1);
  });
});
