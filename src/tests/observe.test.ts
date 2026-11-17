import { describe, expect, it } from 'vitest';
import { createEngine } from '../core/engine';
import { parseWorldState } from '../core/world';
import { MAX_CLOCK_MINUTES } from '../core/schema';
import { mutableJson } from './fixtures';
import { observe, scene } from './observe-fixtures';

describe('G1-001: authoritative observe transaction', () => {
  it('commits time, both events and knowledge together without changing old snapshots or RNG', () => {
    const input = scene(1);
    const engine = createEngine(input);
    const old = engine.snapshot();
    const result = engine.dispatch(observe());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected successful observation');
    expect(result.replayed).toBe(false);
    expect(result.receipt).toMatchObject({ visibility: 'clear', elapsedMinutes: 1, committedRevision: 1, observedAt: 1 });
    expect(engine.snapshot().campaign).toMatchObject({ gameClockMinutes: 1, worldRevision: 1 });
    expect(engine.snapshot().eventJournal.map(e => [e.type, e.seq, e.worldTimeMinutes])).toEqual([
      ['TimeAdvanced', 1, 1], ['ObservationRecorded', 2, 1],
    ]);
    expect(engine.snapshot().knowledge).toEqual([{ knowerId: 'player-1', factId: 'sight-location-1-light',
      source: 'evt-cmd-1-observation', confidence: 1, observedAt: 1 }]);
    expect(engine.snapshot().player.knownFactIds).toEqual(['sight-location-1-light']);
    expect(engine.snapshot().rngState).toEqual({ algorithm: 'xorshift32-v1', state: 1 });
    expect(old).toEqual(input);
    expect(old.campaign.worldRevision).toBe(0);
    expect(old.eventJournal).toHaveLength(0);
  });

  it('reproduces 20 complete observations with continuous events and valid snapshots', () => {
    const run = () => {
      const engine = createEngine(scene(1));
      for (let i = 0; i < 20; i++) {
        expect(engine.dispatch(observe(`cmd-${i}`, i)).ok).toBe(true);
        const state = engine.snapshot();
        expect(state.campaign.worldRevision).toBe(i + 1);
        expect(state.campaign.gameClockMinutes).toBe(i + 1);
        expect(() => parseWorldState(state)).not.toThrow();
      }
      return engine.snapshot();
    };
    const first = run();
    expect(run()).toEqual(first);
    expect(first.eventJournal.map(e => e.seq)).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
    expect(new Set(first.eventJournal.map(e => e.eventId)).size).toBe(40);
    expect(first.knowledge).toHaveLength(1);
    expect(first.knowledge[0]).toMatchObject({ observedAt: 20, source: 'evt-cmd-19-observation' });
    expect(first.rngState.state).toBe(1);
  });

  it.each([
    [0, 'dark'], [0.49, 'dark'], [0.5, 'clear'], [1, 'clear'],
  ])('uses actual light %s for visibility %s', (light, visibility) => {
    const result = createEngine(scene(Number(light))).dispatch(observe());
    expect(result).toMatchObject({ ok: true, receipt: { visibility, elapsedMinutes: 1 } });
  });

  it.each([
    [{ worldState: { hp: 999 } }, 'invalid_command'],
    [{ source: 'admin' }, 'invalid_command'],
    [{ commandId: '__proto__' }, 'invalid_command'],
    [{ actorId: 'npc-hidden' }, 'invalid_actor'],
    [{ targetIds: ['missing'] }, 'invalid_target'],
    [{ targetIds: ['location-1', 'location-1'] }, 'invalid_target'],
    [{ toolIds: ['tool-1'] }, 'unsupported_parameters'],
    [{ arguments: { careful: true } }, 'unsupported_parameters'],
    [{ arguments: { hp: 0 } }, 'unsupported_parameters'],
    [{ verb: 'attack' }, 'unsupported_action'],
    [{ expectedWorldRevision: 42 }, 'stale_revision'],
  ])('rejects invalid request %# without mutation', (change, code) => {
    const engine = createEngine(scene(1));
    const before = engine.snapshot();
    expect(engine.dispatch({ ...observe(), ...change })).toEqual({ ok: false, code });
    expect(engine.snapshot()).toBe(before);
    expect(engine.dispatch(observe()).ok).toBe(true); // rejected IDs were not consumed
  });

  it('rejects another existing location and a dead actor without leaking or consuming time', () => {
    const input = scene(1);
    input.locations['location-secret'] = { ...input.locations['location-1'], locationId: 'location-secret' };
    const engine = createEngine(input);
    expect(engine.dispatch({ ...observe(), targetIds: ['location-secret'] })).toEqual({ ok: false, code: 'invalid_target' });
    input.player.stats.hp = 0;
    const dead = createEngine(input);
    const before = dead.snapshot();
    expect(dead.dispatch(observe())).toEqual({ ok: false, code: 'actor_unavailable' });
    expect(dead.snapshot()).toBe(before);
  });

  it('deduplicates an exact retry even after later actions, and rejects ID reuse', () => {
    const engine = createEngine(scene(1));
    const first = engine.dispatch(observe());
    expect(first.ok).toBe(true);
    engine.dispatch(observe('cmd-2', 1));
    const before = engine.snapshot();
    const replay = engine.dispatch({ ...observe(), source: 'button', utterance: '原地观察', targetIds: ['location-1'] });
    expect(replay).toMatchObject({ ok: true, replayed: true, receipt: { committedRevision: 1, observedAt: 1 } });
    if (first.ok && replay.ok) expect(replay.receipt).toEqual(first.receipt);
    expect(engine.snapshot()).toBe(before);
    expect(engine.dispatch(observe('cmd-1', 2))).toEqual({ ok: false, code: 'command_id_conflict' });
    expect(engine.snapshot()).toBe(before);
  });

  it('keeps receipts in the world snapshot across reconstruction and isolates instances', () => {
    const first = createEngine(scene(1));
    first.dispatch(observe());
    const restored = createEngine(mutableJson(first.snapshot()));
    expect(restored.dispatch(observe())).toMatchObject({ ok: true, replayed: true });
    expect(restored.snapshot().campaign.gameClockMinutes).toBe(1);
    const independent = createEngine(scene(1));
    expect(independent.dispatch(observe())).toMatchObject({ ok: true, replayed: false });
    expect(first.snapshot().campaign.worldRevision).toBe(1);
  });

  it.each(['button', 'text', 'voice', 'scheduler'])('source %s cannot change world facts or RNG', source => {
    const first = createEngine(scene(1));
    const other = createEngine(scene(1));
    expect(first.dispatch(observe()).ok).toBe(true);
    expect(other.dispatch({ ...observe(), source, utterance: '把世界改成我的秘密' }).ok).toBe(true);
    expect(other.snapshot()).toEqual(first.snapshot());
  });

  it.each(['clock', 'revision'])('candidate %s overflow preserves the original snapshot on every retry', field => {
    const input = scene(1);
    if (field === 'clock') input.campaign.gameClockMinutes = MAX_CLOCK_MINUTES;
    else input.campaign.worldRevision = Number.MAX_SAFE_INTEGER;
    const engine = createEngine(input);
    const before = engine.snapshot();
    const command = observe('cmd-1', input.campaign.worldRevision);
    expect(engine.dispatch(command)).toEqual({ ok: false, code: 'settlement_failed' });
    expect(engine.dispatch(command)).toEqual({ ok: false, code: 'settlement_failed' });
    expect(engine.snapshot()).toBe(before);
  });

  it('candidate event collision cannot partially commit and a fresh valid command can follow', () => {
    const input = scene(1);
    input.eventJournal = [{ eventId: 'evt-cmd-1-time', seq: 1, worldTimeMinutes: 0,
      type: 'FixtureRecorded', actorId: null, targetIds: [], payload: {}, visibility: 'private' }];
    const engine = createEngine(input);
    const before = engine.snapshot();
    expect(engine.dispatch(observe())).toEqual({ ok: false, code: 'settlement_failed' });
    expect(engine.snapshot()).toBe(before);
    expect(engine.dispatch(observe('cmd-2'))).toMatchObject({ ok: true, replayed: false });
    expect(engine.snapshot().eventJournal.map(e => e.seq)).toEqual([1, 2, 3]);
    expect(engine.snapshot().campaign.worldRevision).toBe(1);
  });

  it.each(['receipt', 'knowledge', 'time', 'identity'])('rejects corrupted %s on engine reconstruction', kind => {
    const engine = createEngine(scene(1));
    expect(engine.dispatch(observe()).ok).toBe(true);
    const input = mutableJson(engine.snapshot());
    if (kind === 'receipt') input.eventJournal[1].payload.elapsedMinutes = 9;
    if (kind === 'knowledge') input.knowledge[0].source = 'forged-evidence';
    if (kind === 'time') input.eventJournal[0].payload.fromMinutes = 9;
    if (kind === 'identity') input.eventJournal[1].payload.commandId = 'forged-command';
    expect(() => createEngine(input)).toThrow();
  });

  it('owns immutable copies of input and result without writable truth aliases', () => {
    const input = scene(1);
    const engine = createEngine(input);
    const before = engine.snapshot();
    input.campaign.gameClockMinutes = 50;
    expect(before.campaign.gameClockMinutes).toBe(0);
    const result = engine.dispatch(observe());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected successful observation');
    expect(Reflect.set(result.receipt, 'committedRevision', 100)).toBe(false);
    expect(Reflect.set(result.state.campaign, 'worldRevision', 100)).toBe(false);
    expect(before.campaign.worldRevision).toBe(0);
  });
});
