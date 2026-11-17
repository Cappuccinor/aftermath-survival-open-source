import { createBuildingGame, createBuildingPrototype } from './building-prototype';
import { parseWorldState } from './world';
import { readBuildingScene } from './building-scene';
import { cabinetId, waterId, cabinetScopeId, cabinetKnownFact, cabinetItems } from './cabinet-model';
import { readCabinetScope } from './cabinet-history';
import type { WorldState } from './world';
export function addCabinetScene(input: unknown): WorldState {
  const world = parseWorldState(input), building = readBuildingScene(world);
  if (!building || readCabinetScope(world) || world.campaign.gameClockMinutes !== 0 || world.campaign.worldRevision !== 0
    || world.player.locationId !== building.roomId || world.eventJournal.at(-1)?.eventId !== 'evt-initial-building-scene') throw Error('Cabinet requires untouched building');
  const playerId = world.player.playerId;
  return parseWorldState({ ...world, items: { ...world.items, ...cabinetItems(building.roomId) },
    player: { ...world.player, knownFactIds: [...world.player.knownFactIds, cabinetKnownFact] },
    knowledge: [...world.knowledge, { knowerId: playerId, factId: cabinetKnownFact, source: cabinetScopeId, confidence: 1, observedAt: 0 }],
    eventJournal: [...world.eventJournal, { eventId: cabinetScopeId, seq: world.eventJournal.length + 1, type: 'CabinetSceneInitialized',
      actorId: playerId, targetIds: [cabinetId], visibility: 'private', worldTimeMinutes: 0,
      payload: { rule: 'cabinet-scope-v1', playerId, locationId: building.roomId, cabinetId, waterId, buildingSourceEventId: 'evt-initial-building-scene' } }],
  });
}
export function createCabinetPrototype(seed = 1): WorldState { return addCabinetScene(createBuildingPrototype(seed)); }
export function createCabinetGame(...args: Parameters<typeof createBuildingGame>): WorldState { return addCabinetScene(createBuildingGame(...args)); }
