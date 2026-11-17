import { describe, expect, it } from 'vitest';
import { createGame } from '../application/game';
import { doorCommand, doorFixture, doorId, doorVectors, oldCommand } from './door-fixtures';

describe('G1-008: sensory-only application results', () => {
  it.each(doorVectors)('seed $seed exposes only $visual and an evidence-backed sound', async vector => {
    const world = doorFixture(vector.seed); world.items['prototype-tin'].metadata = { hidden: 'SECRET_gun' };
    world.player.background = 'SECRET_identity';
    const game = createGame(world), result = await game.dispatch(doorCommand());
    expect(result.ok).toBe(true); if (!result.ok) throw Error();
    const descriptions = { none: '未能辨清门外的细节', shadow: '一道模糊的影子', shoes: '一双旧鞋的轮廓' };
    expect(result.outcome.summary).toContain(descriptions[vector.visual]);
    expect(result.outcome.summary.includes('衣料摩擦')).toBe(vector.noticed);
    expect(result.outcome.facts).toHaveLength((vector.visual === 'none' ? 0 : 1) + (vector.noticed ? 1 : 0));
    expect(result).toMatchObject({ doorTargets: [{ targetId: doorId, label: '门缝' }],
      clock: { worldRevision: 1, gameClockMinutes: 1 }, persistence: { ok: false, code: 'not_implemented' } });
    expect(JSON.stringify(result)).not.toMatch(/SECRET|witness|npcId|alertness|noticed|firstNoticed|Roll|rng|sourceEventId|安全|暴露|概率|持枪/);
    expect(Object.keys(result.outcome).sort()).toEqual(['facts', 'summary']);
    expect(Object.isFrozen(result.outcome)).toBe(true);
  });

  it('unknown NPC/door/location targets are indistinguishable refusals, not sensory facts', async () => {
    const game = createGame(doorFixture());
    for (const id of ['prototype-witness', 'hidden-npc', 'unknown-door', 'prototype-corridor']) {
      expect(await game.dispatch({ ...doorCommand(), targetIds: [id] })).toEqual({ ok: false, code: 'invalid_target' });
    }
    expect(await game.dispatch(doorCommand())).toMatchObject({ ok: true, clock: { gameClockMinutes: 1 } });
  });

  it('old result narrative is replayed while targets/status/clock reflect the current location', async () => {
    const game = createGame(doorFixture()); const first = await game.dispatch(doorCommand());
    await game.dispatch(oldCommand(1, 'move', 'prototype-corridor'));
    const replay = await game.dispatch(doorCommand());
    expect(replay).toMatchObject({ ok: true, replayed: true, doorTargets: [], clock: { worldRevision: 2 } });
    if (replay.ok && first.ok) { expect(replay.outcome).toEqual(first.outcome); expect(replay.playerStatus).toEqual(first.playerStatus); }
    expect(await game.dispatch(oldCommand(2, 'move', 'prototype-location')))
      .toMatchObject({ ok: true, doorTargets: [{ targetId: doorId, label: '门缝' }] });
  });
});
