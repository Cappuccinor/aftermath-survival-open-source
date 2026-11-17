import { visibleSearchTargets } from '../src/core/search';
import { projectLocation, visibleRoutes } from '../src/core/movement';
import { createLifecycleGame, createLifecyclePrototype } from '../src/core/npc-lifecycle-prototype';
import { projectSceneContext } from '../src/application/scene-context';
import { visiblePickupTargets } from '../src/core/pickup';
import { projectInventory } from '../src/application/inventory';
import { visibleDoorTargets } from '../src/core/door-observation';
import { visibleInspectionTargets } from '../src/core/inspection';
import { createGame } from '../src/application/game';
import { projectClock } from '../src/application/clock';
import { projectPlayerStatus } from '../src/application/player-status';
import { createObservationSession } from '../src/application/session';
import { localIntentInterpreter } from '../src/adapters/ai/local-intent';
import { mountObservationUI } from '../src/ui/main';
import { readCharacterProfile } from '../src/core/character';
import type { WorldState } from '../src/core/world';
import { createCharacterCreation } from '../src/application/character-creation';

// Trusted isolated composition only; never imported by production bootstrap.
export function install() {
const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Missing application root');
function sessionFor(world: WorldState) {
  const npc=world.npcs[0];
  if(npc?.kind!=='g1-static-witness-v2'||npc.life.status!=='dead'||world.items['prototype-hidden-handgun']?.position.id!==npc.npcId)throw Error('Invalid isolated lifecycle fixture');
  return createObservationSession({ client: createGame(world), interpreter: localIntentInterpreter,
    initialSceneContext: projectSceneContext(world),
    initialPlayerStatus: projectPlayerStatus(world),
    initialDoorTargets: visibleDoorTargets(world),
    initialPickupTargets: visiblePickupTargets(world), initialInventory: projectInventory(world),
    actorId: world.player.playerId, initialClock: projectClock(world), initialSearchTargets: visibleSearchTargets(world), initialTargets: visibleInspectionTargets(world), initialLocation: projectLocation(world), initialRoutes: visibleRoutes(world) });
}
const prototype = () => ({ session: sessionFor(createLifecyclePrototype(1, 'dead')), character: null });
const creation = createCharacterCreation({ prototype,
  create(input) {
    const seed = 1;
    const world = createLifecycleGame(input, { seed, saveId: `world-${crypto.randomUUID()}`,
      playerId: `player-${crypto.randomUUID()}`, createdAt: new Date().toISOString() }, 'dead');
    return { session: sessionFor(world), character: readCharacterProfile(world) };
  },
}, 'building-room');
mountObservationUI(root, () => prototype().session, creation);

}
