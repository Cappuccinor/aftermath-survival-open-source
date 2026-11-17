import { visibleSearchTargets } from '../core/search';
import {projectContactTarget} from './contact';
import { projectLocation, visibleRoutes } from '../core/movement';
import { createEngine } from '../core/engine';
import { unavailableStorage } from '../adapters/storage/port';
import type { ActionReply, GameClient } from './ports';
import { projectClock } from './clock';
import { projectPlayerStatus } from './player-status';
import { visibleDoorTargets } from '../core/door-observation';
import { visibleInspectionTargets } from '../core/inspection';
import { visiblePickupTargets } from '../core/pickup';
import { projectInventory } from './inventory';
import { projectSceneContext } from './scene-context';
import { createNarrationPresenter } from './narration';
import type { NarrationOptions } from './narration';
import type { WorldState } from '../core/world';
import { projectReceiptOutcome } from './receipt-outcome';
export interface GameOptions extends NarrationOptions { readonly onCommitted?: (state: WorldState) => void }

/** Trusted composition boundary; hand only the returned GameClient to presentation. */
export function createGame(initialState: unknown, options: GameOptions = {}): GameClient {
  const engine = createEngine(initialState);
  const present = createNarrationPresenter(options);
  return Object.freeze({
    async dispatch(input: unknown): Promise<ActionReply> {
      // Synchronous Core commit happens before any asynchronous adapter is invoked.
      const result = engine.dispatch(input);
      if (!result.ok) return Object.freeze({ ok: false, code: result.code });
      options.onCommitted?.(result.state);
      const safeOutcome = projectReceiptOutcome(result.state, result.receipt);
      // Replays use their original receipt template, never a second provider call or a global cache.
      const outcome = result.replayed ? safeOutcome : await present(safeOutcome);
      const persistence = Object.freeze(await unavailableStorage.save({ worldState: result.state }));
      // Deliberate whitelist: never spread a Core result into a client result.
      return Object.freeze({ ok: true, committedRevision: result.receipt.committedRevision,
        ...(result.state.stateSchema==='g2-world-v2'?{contactTarget: projectContactTarget(result.state)}:{}),
        doorTargets: visibleDoorTargets(result.state),
        pickupTargets: visiblePickupTargets(result.state), inventory: projectInventory(result.state),
        sceneContext: projectSceneContext(result.state),
        playerStatus: projectPlayerStatus(result.state),
        searchTargets: visibleSearchTargets(result.state), currentLocation: projectLocation(result.state), routes: visibleRoutes(result.state),
        replayed: result.replayed, outcome, persistence, clock: projectClock(result.state), inspectTargets: visibleInspectionTargets(result.state) });
    },
  });
}
