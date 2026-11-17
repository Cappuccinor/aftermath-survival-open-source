import { createHiddenItemPrototype, createHiddenItemGame } from './npc-hidden-item-prototype';
import { parseWorldState } from './world';
import type { WorldState } from './world';
import { lifecycleId, lifeSchema } from './npc-lifecycle-model';
export function addNpcLifecycle(input: unknown, status: 'alive' | 'dead' = 'alive'): WorldState {
  const w = parseWorldState(input), npc = w.npcs[0];
  if (!npc || npc.kind !== 'g1-door-witness-v1' || w.campaign.worldRevision !== 0 || w.campaign.gameClockMinutes !== 0
    || w.eventJournal.at(-1)?.eventId !== 'evt-initial-npc-hidden-item') throw Error('Lifecycle requires untouched hidden world');
  const life = lifeSchema.parse(status === 'dead' ? { status, source: 'pre-game-fixture-v1', cause: 'unspecified-pre-game-death', atGameMinutes: -1 } : { status });
  const initialNpc = { ...npc, kind: 'g1-static-witness-v2' as const, life };
  return parseWorldState({ ...w, npcs: [initialNpc], eventJournal: [...w.eventJournal, {
    eventId: lifecycleId, seq: w.eventJournal.length + 1, type: 'NpcLifecycleInitialized', actorId: w.player.playerId,
    targetIds: [npc.npcId], visibility: 'private', worldTimeMinutes: 0,
    payload: { rule: 'npc-lifecycle-scope-v1', playerId: w.player.playerId, hiddenSourceEventId: 'evt-initial-npc-hidden-item', initialNpc },
  }] });
}
export const createLifecyclePrototype = (seed = 1, status: 'alive' | 'dead' = 'alive') => addNpcLifecycle(createHiddenItemPrototype(seed), status);
export const createLifecycleGame = (...args: [...Parameters<typeof createHiddenItemGame>, ('alive' | 'dead')?]) => addNpcLifecycle(createHiddenItemGame(args[0], args[1]), args[2]);
