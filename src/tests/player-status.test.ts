import { describe, expect, it } from 'vitest';
import { copyPlayerStatus, projectPlayerStatus } from '../application/player-status';
import { createGame } from '../application/game';
import { createEngine } from '../core/engine';
import { createSearchPrototype } from '../core/prototype';
import { parseWorldState } from '../core/world';
import type { WorldState } from '../core/world';
import { mutableJson } from './fixtures';

const status = { hp: 0, stamina: 100, mental: 73, hunger: 12, thirst: 34,
  fatigue: 56, infection: 7, pain: 89, bodyTempC: 37.25, carryWeightKg: 2.5 };
const bounded = ['hp', 'stamina', 'mental', 'hunger', 'thirst', 'fatigue', 'infection', 'pain'] as const;
const keys = [...bounded, 'bodyTempC', 'carryWeightKg'] as const;
function variedWorld(hp = status.hp) {
  const world = mutableJson(createSearchPrototype());
  world.player.stats = { ...status, hp };
  return parseWorldState(world);
}
function command(verb: string, revision: number, targetIds: string[] = []) {
  return { commandId: `status-${revision}`, actorId: 'prototype-player', source: 'button', verb,
    targetIds, toolIds: [], arguments: {}, utterance: verb, expectedWorldRevision: revision };
}

describe('G1-007: own player status projection', () => {
  it('projects exactly ten actual values from validated world without mutation or aliases', () => {
    const world = variedWorld(); const before = JSON.stringify(world);
    const visible = projectPlayerStatus(world);
    expect(visible).toEqual(status);
    expect(Object.keys(visible).sort()).toEqual([...keys].sort());
    expect(visible).not.toBe(world.player.stats);
    expect(Object.isFrozen(visible)).toBe(true);
    expect(Reflect.set(visible, 'hp', 88)).toBe(false);
    expect(JSON.stringify(world)).toBe(before);
  });

  it('whitelists extra hidden values, freezes a new copy and never invokes accessors', () => {
    const input = { ...status, metadata: { secret: true } };
    Object.defineProperty(input, 'secret', { get() { throw Error('must not read'); } });
    const visible = copyPlayerStatus(input);
    expect(visible).toEqual(status); expect(Object.isFrozen(visible)).toBe(true);
    input.hp = 50; input.metadata.secret = false;
    expect(visible?.hp).toBe(0);
    expect(JSON.stringify(visible)).not.toMatch(/metadata|secret/);
  });

  it.each(keys)('rejects missing, inherited, string and nonfinite %s', key => {
    const missing: Record<string, unknown> = { ...status }; delete missing[key];
    expect(copyPlayerStatus(missing)).toBeNull();
    expect(copyPlayerStatus(Object.assign(Object.create({ [key]: status[key] }), missing))).toBeNull();
    for (const value of ['0', null, undefined, NaN, Infinity, -Infinity]) {
      expect(copyPlayerStatus({ ...status, [key]: value })).toBeNull();
    }
  });

  it.each(bounded)('accepts both inclusive bounds and rejects out-of-range %s', key => {
    for (const value of [0, 100]) expect(copyPlayerStatus({ ...status, [key]: value })?.[key]).toBe(value);
    for (const value of [-0.01, 100.01]) expect(copyPlayerStatus({ ...status, [key]: value })).toBeNull();
  });

  it('keeps units raw, without invented medical thresholds or weight capacity', () => {
    expect(copyPlayerStatus({ ...status, bodyTempC: -1, carryWeightKg: 500.25 }))
      .toEqual({ ...status, bodyTempC: -1, carryWeightKg: 500.25 });
    expect(copyPlayerStatus({ ...status, carryWeightKg: 0 })?.carryWeightKg).toBe(0);
    expect(copyPlayerStatus({ ...status, carryWeightKg: -0.01 })).toBeNull();
  });

  it.each([null, undefined, 1, 'status', [], Object.create(status)])('rejects non-object or non-own status %#', input => {
    expect(copyPlayerStatus(input)).toBeNull();
  });

  it('contains hostile property access without invoking getters or throwing', () => {
    let reads = 0;
    const getter = { ...status }; Object.defineProperty(getter, 'hp', { get() { reads++; throw Error('getter'); } });
    expect(copyPlayerStatus(getter)).toBeNull(); expect(reads).toBe(0);
    const proxy = new Proxy(status, { getOwnPropertyDescriptor() { throw Error('proxy'); } });
    expect(copyPlayerStatus(proxy)).toBeNull();
    const revoked = Proxy.revocable(status, {}); revoked.revoke();
    expect(copyPlayerStatus(revoked.proxy)).toBeNull();
    expect(() => projectPlayerStatus({ player: { stats: {} } } as WorldState)).toThrow();
  });

  it('all four real verbs and replay return actual stats with unchanged world resources/RNG', async () => {
    const world = variedWorld(63); const engine = createEngine(world); const game = createGame(world);
    const commands = [command('observe', 0), command('search', 1, ['prototype-location']),
      command('inspect', 2, ['prototype-tin']), command('move', 3, ['prototype-corridor'])];
    for (const input of commands) {
      const result = engine.dispatch(input); expect(result.ok).toBe(true);
      const reply = await game.dispatch(input);
      expect(reply).toMatchObject({ ok: true, playerStatus: { ...status, hp: 63 },
        clock: { worldRevision: input.expectedWorldRevision + 1, gameClockMinutes: input.expectedWorldRevision + 1 } });
      expect(engine.snapshot().player.stats).toEqual(world.player.stats);
      expect(engine.snapshot().items).toEqual(world.items);
      expect(engine.snapshot().rngState).toEqual(world.rngState);
    }
    expect(await game.dispatch(commands[0])).toMatchObject({ ok: true, replayed: true,
      committedRevision: 1, clock: { worldRevision: 4 }, playerStatus: { ...status, hp: 63 } });
  });

  it('a restored old receipt projects current snapshot stats, not the original action or preview', async () => {
    const engine = createEngine(variedWorld(63)); const original = command('observe', 0);
    expect(engine.dispatch(original).ok).toBe(true);
    // A valid fixture without a character record; no production stat-changing rule is introduced.
    const restored = mutableJson(engine.snapshot()); restored.player.stats.hp = 42;
    const game = createGame(parseWorldState(restored));
    expect(await game.dispatch(original)).toMatchObject({ ok: true, replayed: true,
      committedRevision: 1, playerStatus: { ...status, hp: 42 } });
  });
});
