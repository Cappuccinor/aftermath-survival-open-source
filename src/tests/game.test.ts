import { describe, expect, it } from 'vitest';
import { createGame } from '../application/game';
import { createEngine } from '../core/engine';
import { mutableJson } from './fixtures';
import { observe, scene } from './observe-fixtures';

describe('G1-001: visible application capability', () => {
  it.each([0, 1])('rejects a corrupted visibility receipt before returning narrative at light %s', light => {
    const engine = createEngine(scene(light));
    expect(engine.dispatch(observe()).ok).toBe(true);
    const snapshot = mutableJson(engine.snapshot());
    expect(() => createGame(snapshot)).not.toThrow();
    snapshot.eventJournal[1].payload.visibility = light === 0 ? 'clear' : 'dark';
    expect(() => createGame(snapshot)).toThrow('Inconsistent observe-v1 journal');
  });

  it.each([0, 1])('returns only permitted observations at light %s, with explicit unsaved feedback', async light => {
    const input = scene(light);
    input.locations['location-1'].name = 'SECRET_location_name';
    input.player.background = 'SECRET_background';
    input.locations['secret-room'] = { ...input.locations['location-1'], locationId: 'secret-room', name: 'SECRET_other_room' };
    input.items = {
      box: { itemId: 'box', typeId: 'SECRET_box_type', position: { kind: 'location', id: 'location-1' },
        count: 1, weightKg: 1, durability: 100, condition: 'SECRET_condition', metadata: { secret: 'SECRET_metadata' } },
      hidden: { itemId: 'hidden', typeId: 'SECRET_gun', position: { kind: 'container', id: 'box' },
        count: 1, weightKg: 1, durability: 100, condition: '', metadata: {} },
      distant: { itemId: 'distant', typeId: 'SECRET_remote_item', position: { kind: 'location', id: 'secret-room' },
        count: 1, weightKg: 1, durability: 100, condition: '', metadata: {} },
    };
    const game = createGame(input);
    expect(Object.keys(game)).toEqual(['dispatch']);
    const result = await game.dispatch({ ...observe(), utterance: 'SECRET_raw_utterance' });
    expect(result).toMatchObject({ ok: true, committedRevision: 1, replayed: false,
      persistence: { ok: false, code: 'not_implemented' } });
    expect(JSON.stringify(result)).not.toMatch(/SECRET_|secret-room|rngState|eventJournal|worldState|metadata|itemId/);
    if (!result.ok) throw new Error('Expected visible result');
    expect(result.outcome.facts).toHaveLength(1);
    expect(result.outcome.summary).toContain('一分钟');
    expect(result.outcome.facts[0]?.description).toContain(light === 0 ? '无法看清' : '光线足够');
    expect(Object.keys(result).sort()).toEqual(['clock', 'committedRevision', 'currentLocation', 'doorTargets', 'inspectTargets', 'inventory', 'ok', 'outcome', 'persistence', 'pickupTargets', 'playerStatus', 'replayed', 'routes', 'sceneContext', 'searchTargets']);
    expect(result.inspectTargets).toEqual([]);
    expect(result.clock).toEqual({ worldRevision: 1, gameClockMinutes: 1, label: '生存第 1 天 · 08:01 · 灾变第 30 天' });
    expect(Reflect.set(result.outcome, 'summary', 'forged')).toBe(false);
  });

  it('keeps retry results tied to the original observation and serializes concurrent dispatches', async () => {
    const game = createGame(scene(1));
    const [first, second] = await Promise.all([game.dispatch(observe()), game.dispatch(observe('cmd-2', 1))]);
    expect(first).toMatchObject({ ok: true, committedRevision: 1 });
    expect(second).toMatchObject({ ok: true, committedRevision: 2 });
    const replay = await game.dispatch(observe());
    expect(replay).toMatchObject({ ok: true, committedRevision: 1, replayed: true,
      clock: { worldRevision: 2, gameClockMinutes: 2 },
      persistence: { ok: false, code: 'not_implemented' } });
    if (first.ok && replay.ok) expect(replay.outcome).toEqual(first.outcome);
    expect(await game.dispatch(observe('cmd-3', 2))).toMatchObject({ ok: true, committedRevision: 3 });
  });

  it('cannot turn a forged world or unimplemented intent into a success', async () => {
    const game = createGame(scene(1));
    expect(await game.dispatch({ ...observe(), worldState: { hp: 0 } })).toEqual({ ok: false, code: 'invalid_command' });
    expect(await game.dispatch({ ...observe(), verb: 'set_hp', arguments: { hp: 0 } })).toEqual({ ok: false, code: 'unsupported_action' });
    expect(await game.dispatch(observe())).toMatchObject({ ok: true, committedRevision: 1 });
  });
});
