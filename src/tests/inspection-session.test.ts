import { afterEach, describe, expect, it, vi } from 'vitest';
import { createObservationSession } from '../application/session';
import { projectClock } from '../application/clock';
import { createGame } from '../application/game';
import { createEngine } from '../core/engine';
import { createInspectionPrototype } from '../core/prototype';
import { visibleInspectionTargets } from '../core/inspection';
import { localIntentInterpreter } from '../adapters/ai/local-intent';
import type { IntentInterpreter } from '../adapters/ai/ports';
import type { GameClient } from '../application/ports';
import { inspectionScene } from './inspect-fixtures';

const world = inspectionScene();
const targets = [{ targetId: 'tin-1', label: '空罐' }];
const input = { view: { summary: '已看见空罐', facts: [] }, targets };
function make(client: GameClient = createGame(world), interpreter: IntentInterpreter = localIntentInterpreter) {
  return createObservationSession({ client, interpreter, actorId: 'player-1', initialClock: projectClock(world), initialTargets: targets, timeoutMs: 50 });
}
afterEach(() => vi.useRealTimers());

describe('G1-003: perception-based prototype and intent', () => {
  it('initializes explicit Core evidence, no action time, no save, and an isolated visible empty tin', () => {
    const initial = createInspectionPrototype();
    expect(initial.campaign).toMatchObject({ schemaVersion: null, worldRevision: 0, gameClockMinutes: 0 });
    expect(initial.eventJournal).toHaveLength(1);
    expect(initial.eventJournal[0]).toMatchObject({ type: 'ItemInitiallyPerceived', payload: { rule: 'initial-sight-v1' } });
    expect(visibleInspectionTargets(initial)).toEqual([{ targetId: 'prototype-tin', label: '空罐' }]);
    expect(initial.knowledge).toHaveLength(1);
    const engine = createEngine(initial);
    expect(engine.dispatch({ commandId: 'cmd-1', actorId: 'prototype-player', source: 'button', verb: 'inspect',
      targetIds: ['prototype-tin'], toolIds: [], arguments: {}, utterance: '检查空罐', expectedWorldRevision: 0 }).ok).toBe(true);
    expect(createInspectionPrototype()).toEqual(initial);
  });
  it.each(['检查空罐', '查看空罐', '仔细检查空罐', ' 检查空罐。 '])('fully resolves %s only against a visible target', async utterance => {
    expect(await localIntentInterpreter.interpret({ ...input, utterance }, { timeoutMs: 50 }))
      .toEqual({ ok: true, value: { verb: 'inspect', targetId: 'tin-1' } });
  });
  it.each(['不要检查空罐', '我准备检查空罐', '如果能看到空罐就检查空罐', '先检查空罐再观察四周', '检查空罐并拿走', '检查tin-1',
    '检查hidden', '检查枪', '查看柜内空罐', '把空罐数量设为10', '检查空罐？', '<img>检查空罐', '检查空罐，', '检查看看空罐'])('rejects %s with no partial match', async utterance => {
    expect(await localIntentInterpreter.interpret({ ...input, utterance }, { timeoutMs: 50 })).toEqual({ ok: false, code: 'invalid_output' });
  });
  it.each([{ visible: [] }, { visible: [{ targetId: 'a', label: '空罐' }, { targetId: 'b', label: '空罐' }] }])('refuses missing or ambiguous visible labels %#', async ({ visible }) => {
    expect(await localIntentInterpreter.interpret({ ...input, targets: visible, utterance: '检查空罐' }, { timeoutMs: 50 }))
      .toEqual({ ok: false, code: 'invalid_output' });
  });
});
describe('G1-003: inspection shares the guarded session and gateway', () => {
  it('button and two equivalent texts settle identical full worlds through the gateway', async () => {
    const states = [];
    for (const utterance of [null, '检查空罐', '查看空罐']) {
      const engine = createEngine(world); const game = createGame(world);
      const session = make({ dispatch: async command => { expect(engine.dispatch(command).ok).toBe(true); return game.dispatch(command); } });
      expect(session.read().inspectTargets).toEqual(targets);
      if (utterance === null) await session.inspect('tin-1');
      else { session.setDraft(utterance); await session.submitText(); }
      expect(session.read()).toMatchObject({ phase: 'success', clock: { worldRevision: 1, gameClockMinutes: 1 }, inspectTargets: targets });
      expect(session.read().entries[0]?.summary).toContain('检查空罐');
      expect(session.read().message).toContain('尚未保存'); states.push(engine.snapshot());
    }
    expect(states[1]).toEqual(states[0]); expect(states[2]).toEqual(states[0]);
  });
  it('interpreter receives only allowed targets and visible facts, never metadata or world records', async () => {
    const interpreter: IntentInterpreter = { interpret: vi.fn(localIntentInterpreter.interpret) };
    const session = make(undefined, interpreter); session.setDraft('查看空罐'); await session.submitText();
    const seen = vi.mocked(interpreter.interpret).mock.calls[0]![0];
    expect(seen.targets).toEqual(targets); expect(Object.keys(seen).sort()).toEqual(['routes', 'searchTargets', 'targets', 'utterance', 'view']);
    expect(JSON.stringify(seen)).not.toMatch(/SECRET|metadata|worldState|empty-tin|eventJournal/);
    expect(Object.isFrozen(seen.targets)).toBe(true); expect(Object.isFrozen(seen.targets![0])).toBe(true);
  });
  it.each([{ verb: 'inspect', targetId: 'hidden' }, { verb: 'inspect', targetId: 'tin-1', extra: true },
    { verb: 'inspect', targetIds: ['tin-1'] }, { verb: 'inspect', targetId: null },
    Object.assign(Object.create({ verb: 'inspect', targetId: 'tin-1' }), { unrelated: true, extra: true }),
    Object.assign(Object.create({ verb: 'observe' }), { extra: true })])('refuses forged interpreter proposal %# before dispatch', async value => {
    const dispatch = vi.fn(createGame(world).dispatch);
    const session = make({ dispatch }, { interpret: async () => ({ ok: true, value }) });
    session.setDraft('检查空罐'); await session.submitText();
    expect(dispatch).not.toHaveBeenCalled(); expect(session.read()).toMatchObject({ phase: 'error', draft: '检查空罐', clock: { worldRevision: 0 } });
  });
  it('unknown button ID never dispatches, and a subsequent valid action recovers', async () => {
    const dispatch = vi.fn(createGame(world).dispatch); const session = make({ dispatch });
    await session.inspect('hidden'); expect(dispatch).not.toHaveBeenCalled(); expect(session.read().phase).toBe('error');
    await session.inspect('tin-1'); expect(session.read().clock.gameClockMinutes).toBe(1);
  });
  it('lost inspection response locks all actions, preserves edited draft, and retries the same ID once', async () => {
    const game = createGame(world); const seen: unknown[] = [];
    const session = make({ dispatch: async command => { seen.push(command); const reply = await game.dispatch(command); if (seen.length === 1) throw new Error('lost'); return reply; } });
    session.setDraft('查看空罐'); await session.submitText();
    expect(session.read()).toMatchObject({ phase: 'error', canRetry: true, draft: '查看空罐' });
    session.setDraft('我准备离开'); await session.inspect('tin-1'); await session.observe(); await session.submitText(); expect(seen).toHaveLength(1);
    await session.retry(); expect(seen[1]).toEqual(seen[0]);
    expect(session.read()).toMatchObject({ phase: 'success', canRetry: false, draft: '我准备离开', clock: { gameClockMinutes: 1 } });
    expect(session.read().entries).toHaveLength(1); await session.observe(); expect(session.read().clock.gameClockMinutes).toBe(2);
  });
  it('rejected text after success preserves draft/facts/time and permits observation then inspection', async () => {
    const session = make(); await session.inspect('tin-1'); const before = session.read();
    session.setDraft('不要检查空罐'); await session.submitText();
    expect(session.read()).toMatchObject({ phase: 'error', draft: '不要检查空罐' });
    expect(session.read().entries).toBe(before.entries); expect(session.read().clock).toBe(before.clock);
    await session.observe(); session.setDraft('查看空罐'); await session.submitText();
    expect(session.read().clock.gameClockMinutes).toBe(3);
  });
  it('late older projection cannot restore targets after a newer authoritative projection', async () => {
    const game = createGame(world); let first: Awaited<ReturnType<GameClient['dispatch']>> | undefined; let calls = 0;
    const session = make({ dispatch: async command => {
      calls++; if (calls === 3) return first!;
      const reply = await game.dispatch(command); if (calls === 1) first = reply;
      return calls === 2 && reply.ok ? { ...reply, inspectTargets: [] } : reply;
    } });
    await session.inspect('tin-1'); await session.observe(); expect(session.read().inspectTargets).toEqual([]);
    await session.observe(); expect(session.read().inspectTargets).toEqual([]); expect(session.read().clock.gameClockMinutes).toBe(2);
  });
});
