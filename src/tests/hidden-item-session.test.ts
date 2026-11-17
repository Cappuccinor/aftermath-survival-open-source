import { afterEach, expect, test, vi } from 'vitest';
import * as core from '../core/engine';
import * as ui from '../ui/main';
import { createGame } from '../application/game';
import { createObservationSession } from '../application/session';
import { localIntentInterpreter } from '../adapters/ai/local-intent';
import { projectClock } from '../application/clock';
import { projectInventory } from '../application/inventory';
import { projectPlayerStatus } from '../application/player-status';
import { projectSceneContext } from '../application/scene-context';
import { projectLocation, visibleRoutes } from '../core/movement';
import { visibleSearchTargets } from '../core/search';
import { visibleInspectionTargets } from '../core/inspection';
import { visiblePickupTargets } from '../core/pickup';
import { visibleDoorTargets } from '../core/door-observation';
import type { WorldState } from '../core/world';
import type { ActionReply, GameClient } from '../application/ports';
import type { IntentInterpreter } from '../adapters/ai/ports';
import { gun, gunType, hiddenInit, hiddenEntries, sequence, action, cabinet, water, tin, room, corridor } from './hidden-item-fixtures';
function session(w: WorldState, client: GameClient = createGame(w), interpreter: IntentInterpreter = localIntentInterpreter) {
  return createObservationSession({ client, interpreter, actorId: w.player.playerId, initialClock: projectClock(w), initialSearchTargets: visibleSearchTargets(w),
    initialTargets: visibleInspectionTargets(w), initialPickupTargets: visiblePickupTargets(w), initialInventory: projectInventory(w), initialPlayerStatus: projectPlayerStatus(w),
    initialSceneContext: projectSceneContext(w), initialDoorTargets: visibleDoorTargets(w), initialLocation: projectLocation(w), initialRoutes: visibleRoutes(w), timeoutMs: 20 });
}
const original = core.createEngine, secret = /handgun|npc-hidden-item|concealed|枪|prototype-witness/;
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function captureEngines() { const engines: ReturnType<typeof core.createEngine>[] = []; vi.spyOn(core, 'createEngine').mockImplementation(w => { const e = original(w); engines.push(e); return e; }); return engines; }
test('actual trusted bootstrap installs real hidden ownership for both public factories while presentation gets only capabilities', async () => {
  const engines = captureEngines(); vi.stubGlobal('document', { querySelector: () => ({}) });
  const mount = vi.spyOn(ui, 'mountObservationUI').mockImplementation(() => () => {});
  await import('../bootstrap'); const call = mount.mock.calls[0]!;
  const prototypeSession = call[1](); expect(engines[0]!.snapshot().items[gun]?.position.kind).toBe('npc');
  expect(JSON.stringify(prototypeSession.read())).not.toMatch(secret);
  const creation = call[2]!, draft = creation.read().draft;
  creation.update({ ...draft, profile: { ...draft.profile, name: '测试幸存者', importantItems: '我记得一把枪' } }); creation.preview(); const created = creation.start();
  expect(created).not.toBeNull(); expect(engines[1]!.snapshot().items[gun]?.position.kind).toBe('npc');
  expect(created!.character!.profile.importantItems).toBe('我记得一把枪'); expect(JSON.stringify(created!.session.read())).not.toMatch(secret);
  expect(Object.values(engines[1]!.snapshot().items).filter(i => i.typeId === gunType)).toHaveLength(1);
});
test.each(hiddenEntries)('%s real game replies and raw Narrator inputs exactly equal old composition across24 actions', async (_, factory, old) => {
  const w = factory(); expect(w.items[gun]?.position.id).toBe(w.npcs[0]!.npcId);
  const inputs: unknown[][] = [[], []];
  const games = [w, old()].map((world, n) => createGame(world, { narrator: { narrate: async (input, context) => { inputs[n]!.push({ input, timeoutMs: context.timeoutMs }); return { ok: false, code: 'not_implemented' }; } } }));
  for (const [n, [verb, target]] of sequence().entries()) {
    const c = action(verb, n, target, w.player.playerId), a = await games[0]!.dispatch(c), b = await games[1]!.dispatch(c);
    expect(a).toEqual(b); expect(a.ok).toBe(true); expect(JSON.stringify([a, inputs[0]])).not.toMatch(secret);
  }
  expect(inputs[0]).toEqual(inputs[1]);
});
test.each(hiddenEntries)('%s all session projections and actual interpreter inputs match old world; user guesses retained without system confirmation', async (_, factory, old) => {
  const inputs: unknown[][] = [[], []], w = factory(); expect(w.items[gun]).toBeDefined();
  const sessions = [w, old()].map((world, i) => session(world, createGame(world), { interpret: async (input, context) => { inputs[i]!.push(input); return localIntentInterpreter.interpret(input, context); } }));
  const phrases = ['观察门缝','请搜索一下房间','检查空罐','搜索柜子','拿起瓶装水','拿起空罐','观察门缝','前往走廊','观察周围','前往房间','搜索柜子'];
  for (const phrase of phrases) {
    for (const s of sessions) { s.setDraft(phrase); await s.submitText(); expect(s.read().phase).toBe('success'); expect(JSON.stringify(s.read())).not.toMatch(secret); }
    expect(sessions[0]!.read()).toEqual(sessions[1]!.read());
  }
  expect(inputs[0]).toEqual(inputs[1]); expect(JSON.stringify(inputs)).not.toMatch(secret);
  for (const phrase of ['抢他的手枪','检查手枪','把那把枪给我',`拾取${gun}`,`检查${w.npcs[0]!.npcId}`]) {
    for (const s of sessions) { const before = s.read(); s.setDraft(phrase); await s.submitText(); expect(s.read()).toMatchObject({ phase: 'error', draft: phrase, clock: before.clock, inventory: before.inventory });
      const { draft: _userInput, ...system } = s.read(); expect(JSON.stringify(system)).not.toMatch(secret); }
    expect(sessions[0]!.read()).toEqual(sessions[1]!.read());
    const last: any = inputs[0]!.at(-1); expect(last.utterance).toBe(phrase); const { utterance: _userInput, ...visible } = last; expect(JSON.stringify(visible)).not.toMatch(secret);
  }
  await sessions[0]!.observe(); expect(sessions[0]!.read().phase).toBe('success');
});
test.each(['inspect','search','pick_up'])('malicious interpreter %s cannot unlock a guessed target or allocate a command', async verb => {
  const w = hiddenEntries[0][1](), engines = captureEngines(), game = createGame(w), dispatch = vi.fn(game.dispatch);
  const s = session(w, { dispatch }, { interpret: async () => ({ ok: true, value: { verb, targetId: gun } }) as any });
  const before = engines[0]!.snapshot(); s.setDraft('检查手枪'); await s.submitText(); expect(dispatch).not.toHaveBeenCalled(); expect(engines[0]!.snapshot()).toBe(before);
  expect(s.read()).toMatchObject({ phase: 'error', draft: '检查手枪' }); expect(s.read().message).not.toMatch(secret);
  expect(await game.dispatch(action(verb, 0, gun))).toEqual({ ok: false, code: 'invalid_target' }); expect(engines[0]!.snapshot()).toBe(before);
  await s.observeDoorGap('prototype-door-gap'); expect(s.read().clock.worldRevision).toBe(1);
});
test.each(['他藏着枪。','你看见手枪。','你得到枪。',`${gun} 属于NPC。`])('Narrator leaked claim %s is rejected; input was already filtered; same committed truth', async claim => {
  const w = hiddenEntries[0][1](), engines = captureEngines(), inputs: unknown[] = [];
  const safe = createGame(w), malicious = createGame(w, { narrator: { narrate: async (input, context) => { inputs.push([input, context]); return { ok: true, value: claim }; } } });
  const c = action('observe', 0, 'prototype-door-gap'), a = await safe.dispatch(c), b = await malicious.dispatch(c);
  expect(b).toEqual(a); expect(b.ok && b.outcome.summary).toContain('旧鞋'); expect(JSON.stringify(inputs)).not.toMatch(secret);
  expect(engines[1]!.snapshot()).toEqual(engines[0]!.snapshot()); expect(engines[1]!.snapshot().items[gun]).toEqual(w.items[gun]);
  expect(JSON.stringify(engines[1]!.snapshot().knowledge)).not.toMatch(/handgun|npc-hidden-item/);
});
test('door pending, edited user draft, timeout, late reply, same-ID confirmation and next action preserve hidden ownership and second world', async () => {
  vi.useFakeTimers(); const w = hiddenEntries[0][1](), engines = captureEngines(), game = createGame(w), commands: unknown[] = [];
  let resolve!: (r: ActionReply) => void, stored!: ActionReply; const late = new Promise<ActionReply>(r => resolve = r);
  const s = session(w, { dispatch: async c => { commands.push(c); stored = await game.dispatch(c); return commands.length === 1 ? late : stored; } }), other = session(hiddenEntries[1][1]());
  const pending = s.observeDoorGap('prototype-door-gap'); await vi.advanceTimersByTimeAsync(1); expect(s.read().phase).toBe('pending');
  s.setDraft('我猜他有枪'); await s.search(room); expect(commands).toHaveLength(1); await vi.advanceTimersByTimeAsync(21); await pending;
  expect(s.read()).toMatchObject({ canRetry: true, draft: '我猜他有枪', clock: { worldRevision: 0 } }); const timedOut = s.read();
  resolve(stored); await vi.advanceTimersByTimeAsync(1); expect(s.read()).toBe(timedOut);
  await s.retry(); expect(commands[1]).toBe(commands[0]); expect(s.read()).toMatchObject({ phase: 'success', draft: '我猜他有枪', clock: { worldRevision: 1 } }); expect(s.read().entries).toHaveLength(1);
  expect(other.read().clock.worldRevision).toBe(0); expect(engines[0]!.snapshot().items[gun]).toEqual(w.items[gun]);
  expect(JSON.stringify([s.read().entries, s.read().message, s.read().pickupTargets])).not.toMatch(secret);
  await s.search(cabinet); await s.pickUp(water); await s.move(corridor); expect(s.read().clock.worldRevision).toBe(4);
  expect(engines[0]!.snapshot().items[gun]).toEqual(w.items[gun]); expect(engines[1]!.snapshot().campaign.worldRevision).toBe(0);
});
