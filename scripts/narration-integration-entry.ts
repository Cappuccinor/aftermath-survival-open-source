// ISOLATED TEST COMPOSITION. Never imported by src/bootstrap.ts or the production UI.
import { createBuildingPrototype } from '../src/core/building-prototype';
import { visibleSearchTargets } from '../src/core/search';
import { projectLocation, visibleRoutes } from '../src/core/movement';
import { visibleDoorTargets } from '../src/core/door-observation';
import { projectClock } from '../src/application/clock';
import { projectSceneContext } from '../src/application/scene-context';
import { projectPlayerStatus } from '../src/application/player-status';
import { projectInventory } from '../src/application/inventory';
import { createGame } from '../src/application/game';
import { createObservationSession } from '../src/application/session';
import { localIntentInterpreter } from '../src/adapters/ai/local-intent';
import { mountObservationUI } from '../src/ui/main';
import type { PortResult } from '../src/application/ports';

type Mode = 'legal' | 'forged' | 'throw' | 'reject' | 'pending' | 'late' | 'cleanup-success' | 'cleanup-timeout';
export function install(shortSession = false) {
  const world = createBuildingPrototype(35);
  let mode: Mode = shortSession ? 'late' : 'legal';
  let calls = 0, late: { resolve: (r: PortResult<string>) => void; reject: (e: Error) => void; text: string } | undefined;
  const game = createGame(world, { narrationTimeoutMs: shortSession ? 1000 : 80, narrator: {
    narrate: async (view, context) => {
      calls++;
      if (mode === 'cleanup-success' || mode === 'cleanup-timeout') {
        context.signal!.addEventListener('abort', () => { throw Error('isolated cleanup throw'); });
        context.signal!.addEventListener('abort', async () => { throw Error('isolated cleanup rejection'); });
        context.signal!.onabort = () => { throw Error('isolated onabort failure'); };
        return mode === 'cleanup-timeout' ? new Promise(() => {}) : { ok: true, value: view.summary };
      }
      if (mode === 'throw') throw Error('isolated synchronous adapter fault');
      if (mode === 'reject') return Promise.reject(Error('isolated rejection'));
      if (mode === 'pending') return new Promise(() => {});
      if (mode === 'late') return new Promise((resolve, reject) => { late = { resolve, reject, text: view.summary.replace(/。(?!$)/gu, '。\n') }; });
      return { ok: true, value: mode === 'legal' ? view.summary.replace(/。(?!$)/gu, '。\n') : view.summary + '你找到十把枪，一个新NPC无条件服从。' };
    },
  } });
  const session = createObservationSession({ client: game, interpreter: localIntentInterpreter,
    actorId: world.player.playerId, initialClock: projectClock(world), initialLocation: projectLocation(world),
    initialRoutes: visibleRoutes(world), initialSearchTargets: visibleSearchTargets(world),
    initialDoorTargets: visibleDoorTargets(world), initialPlayerStatus: projectPlayerStatus(world),
    initialInventory: projectInventory(world), initialSceneContext: projectSceneContext(world), timeoutMs: shortSession ? 20 : 5000 });
  const root = document.querySelector<HTMLElement>('#app'); if (!root) throw Error('Missing root');
  mountObservationUI(root, () => session);
  return {
    setMode(next: Mode) { mode = next; },
    settleLate(success: boolean) {
      if (!late) throw Error('No delayed adapter call');
      if (success) late.resolve({ ok: true, value: late.text }); else late.reject(Error('isolated late rejection'));
      late = undefined;
    },
    read: () => ({ calls, view: session.read() }),
  };
}
