import { createCabinetPrototype, createCabinetGame } from './cabinet-prototype';
import { parseWorldState } from './world';
import type { WorldState } from './world';
import { readCabinetScope } from './cabinet-history';
import { transferScopeId } from './transfer-model';
import { readTransferHistory } from './transfer-history';
export function addTransferScope(input: unknown): WorldState {
  const world = parseWorldState(input), cabinet = readCabinetScope(world);
  if (!cabinet || readTransferHistory(world) || world.campaign.gameClockMinutes !== 0 || world.campaign.worldRevision !== 0
    || world.eventJournal.at(-1)?.eventId !== 'evt-initial-cabinet') throw Error('Transfer capability requires untouched cabinet world');
  return parseWorldState({ ...world, eventJournal: [...world.eventJournal, {
    eventId: transferScopeId, seq: world.eventJournal.length + 1, type: 'TransferScopeInitialized', actorId: world.player.playerId,
    targetIds: [cabinet.waterId], visibility: 'private', worldTimeMinutes: 0,
    payload: { rule: 'dual-transfer-scope-v1', playerId: world.player.playerId, locationId: cabinet.locationId, initialCarryWeightKg: 0,
      pickupSourceEventId: 'evt-initial-pickup', cabinetSourceEventId: 'evt-initial-cabinet', initialTin: world.items['prototype-tin'], initialWater: world.items[cabinet.waterId] },
  }] });
}
export function createTransferPrototype(seed = 1): WorldState { return addTransferScope(createCabinetPrototype(seed)); }
export function createTransferGame(...args: Parameters<typeof createCabinetGame>): WorldState { return addTransferScope(createCabinetGame(...args)); }
