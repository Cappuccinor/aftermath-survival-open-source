import { createTransferPrototype, createTransferGame } from './transfer-prototype';
import { parseWorldState } from './world';
import type { WorldState } from './world';
import { hiddenItem, hiddenItemId, hiddenScopeId } from './npc-hidden-item-model';
import { readHiddenItemScope } from './npc-hidden-item-history';
import { readDoorScope } from './door-observation';
export function addHiddenNpcItem(input: unknown): WorldState {
  const w = parseWorldState(input), door = readDoorScope(w);
  if (!door || readHiddenItemScope(w) || w.campaign.gameClockMinutes !== 0 || w.campaign.worldRevision !== 0
    || w.eventJournal.at(-1)?.eventId !== 'evt-initial-transfer') throw Error('Hidden item requires untouched transfer world');
  const item = hiddenItem(door.npcId);
  return parseWorldState({ ...w, items: { ...w.items, [hiddenItemId]: item }, eventJournal: [...w.eventJournal, {
    eventId: hiddenScopeId, seq: w.eventJournal.length + 1, type: 'NpcHiddenItemInitialized', actorId: w.player.playerId,
    targetIds: [door.npcId, hiddenItemId], visibility: 'private', worldTimeMinutes: 0,
    payload: { rule: 'npc-hidden-item-scope-v1', playerId: w.player.playerId, npcId: door.npcId,
      doorSourceEventId: 'evt-initial-door-gap', transferSourceEventId: 'evt-initial-transfer', initialItem: item },
  }] });
}
export const createHiddenItemPrototype = (seed = 1) => addHiddenNpcItem(createTransferPrototype(seed));
export const createHiddenItemGame = (...args: Parameters<typeof createTransferGame>) => addHiddenNpcItem(createTransferGame(...args));
