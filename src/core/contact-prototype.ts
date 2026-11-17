import { createEngine } from './engine';
import { parseWorldState } from './world';
import { createLifecyclePrototype, createLifecycleGame } from './npc-lifecycle-prototype';

/** Pure conversion of a validated old world, never a storage write or session install. */
export function upgradeContactWorld(input: unknown) {
  const world = createEngine(input).snapshot();
  if (world.stateSchema !== 'g0-world-v1') throw Error('Expected legacy world');
  return parseWorldState({ ...world, stateSchema: 'g2-world-v2', npcMemories: [] });
}
export const createContactPrototype = (seed = 1, status: 'alive' | 'dead' = 'alive') => upgradeContactWorld(createLifecyclePrototype(seed, status));
export const createContactGame = (...args: Parameters<typeof createLifecycleGame>) => upgradeContactWorld(createLifecycleGame(...args));
