import { afterEach, expect, test, vi } from 'vitest';
import { createObservationSession } from '../application/session';
import { createGame } from '../application/game';
import { projectSceneContext } from '../application/scene-context';
import { projectClock } from '../application/clock';
import { projectInventory } from '../application/inventory';
import { createBuildingPrototype } from '../core/building-prototype';
import { projectLocation, visibleRoutes } from '../core/movement';
import { localIntentInterpreter } from '../adapters/ai/local-intent';
import type { ActionReply, GameClient } from '../application/ports';
import { corridor, room } from './pickup-fixtures';
function make(client: GameClient) {
  const w = createBuildingPrototype();
  return createObservationSession({ client, interpreter: localIntentInterpreter, actorId: w.player.playerId,
    initialClock: projectClock(w), initialLocation: projectLocation(w), initialRoutes: visibleRoutes(w),
    initialInventory: projectInventory(w), initialSceneContext: projectSceneContext(w), timeoutMs: 20 });
}
afterEach(() => vi.useRealTimers());
test('pending, late timeout and same-ID confirmation retain last scene/draft, then update once', async () => {
  vi.useFakeTimers(); let resolve!: (r: ActionReply) => void; const late = new Promise<ActionReply>(r => resolve = r);
  const game = createGame(createBuildingPrototype()); let stored!: ActionReply; const requests: unknown[] = [];
  const s = make({ dispatch: async c => { requests.push(c); stored = await game.dispatch(c); return requests.length === 1 ? late : stored; } });
  const initial = s.read(); s.setDraft('前往走廊'); const work = s.submitText(); await vi.advanceTimersByTimeAsync(1);
  expect(s.read()).toMatchObject({ phase: 'pending', sceneContext: initial.sceneContext, inventory: [] });
  s.setDraft('稍后的想法'); await s.observe(); expect(requests).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(20); await work;
  expect(s.read()).toMatchObject({ canRetry: true, sceneContext: initial.sceneContext, draft: '稍后的想法' });
  const timedOut = s.read(); resolve(stored); await vi.advanceTimersByTimeAsync(1); expect(s.read()).toBe(timedOut);
  await s.retry(); expect(requests[1]).toBe(requests[0]);
  expect(s.read()).toMatchObject({ phase: 'success', sceneContext: { locationId: corridor, locationRole: 'corridor' }, draft: '稍后的想法', inventory: [], clock: { worldRevision: 1 } });
  expect(s.read().entries).toHaveLength(1);
});
test('stale context never rolls back; current missing/invalid/conflicting context unavailable, next good reply recovers', async () => {
  const game = createGame(createBuildingPrototype()); let n = 0, stored!: ActionReply;
  const s = make({ dispatch: async c => {
    n++; if (n === 2 && stored.ok) return { ...stored, clock: { ...stored.clock, worldRevision: 0, gameClockMinutes: 0 }, sceneContext: projectSceneContext(createBuildingPrototype()) };
    const r = await game.dispatch(c); if (n === 1) stored = r;
    if (r.ok && n === 3) { const { sceneContext: _omitted, ...old } = r; return old; }
    if (r.ok && n === 4) return { ...r, sceneContext: { ...r.sceneContext!, scene: 'secret' } as any };
    if (r.ok && n === 5) return { ...r, sceneContext: { ...r.sceneContext!, locationId: room } };
    return r;
  } });
  await s.move(corridor); const confirmed = s.read(); await s.observe();
  expect(s.read().sceneContext).toBe(confirmed.sceneContext); expect(s.read().currentLocation).toBe(confirmed.currentLocation);
  for (let n = 0; n < 3; n++) { await s.observe(); expect(s.read().sceneContext).toBeNull(); }
  await s.observe(); expect(s.read().sceneContext).toEqual(confirmed.sceneContext);
  expect(s.read().entries.some(e => e.summary.includes('房间'))).toBe(false);
});
test.each(['搜遍整栋楼', '走上楼梯', '躲藏', '与NPC对话', '攻击', '我准备离开', '不要观察', '搜索并拾取', '把饥饿设成0'])('rejects unsupported %s without scene, draft or clock changes', async text => {
  const game = createGame(createBuildingPrototype()), dispatch = vi.fn(game.dispatch), s = make({ dispatch }), initial = s.read();
  s.setDraft(text); await s.submitText(); expect(dispatch).not.toHaveBeenCalled();
  expect(s.read()).toMatchObject({ phase: 'error', sceneContext: initial.sceneContext, clock: initial.clock, draft: text });
  s.setDraft('看看周围'); await s.submitText(); expect(s.read()).toMatchObject({ phase: 'success', draft: '' });
});
test('rule failure keeps context and old initial context defaults null', async () => {
  const client = { dispatch: async () => ({ ok: false as const, code: 'rejected' }) }, s = make(client), initial = s.read();
  await s.move(corridor); expect(s.read().sceneContext).toBe(initial.sceneContext);
  const old = createObservationSession({ client, interpreter: localIntentInterpreter, actorId: 'old', initialClock: initial.clock });
  expect(old.read().sceneContext).toBeNull();
});
