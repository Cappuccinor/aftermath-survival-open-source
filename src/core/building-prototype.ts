import { parseWorldState } from './world';
import type { WorldState } from './world';
import { createPickupGame, createPickupPrototype } from './pickup-prototype';
import { knownRoute } from './movement';
import { buildingEventId, buildingFactId, readBuildingScene } from './building-scene';

/** Trusted new-world composition only. Existing factories and histories are not relabelled. */
export function addBuildingScene(input: unknown): WorldState {
  const world = parseWorldState(input), route = knownRoute(world);
  if (!route || readBuildingScene(world) || world.campaign.worldRevision !== 0 || world.campaign.gameClockMinutes !== 0
    || world.eventJournal.some(e => e.type === 'TimeAdvanced') || world.player.locationId !== route.roomId) {
    throw new Error('Building identity requires an untouched known room');
  }
  const { playerId } = world.player;
  return parseWorldState({ ...world,
    player: { ...world.player, knownFactIds: [...world.player.knownFactIds, buildingFactId] },
    knowledge: [...world.knowledge, { knowerId: playerId, factId: buildingFactId, source: buildingEventId, confidence: 1, observedAt: 0 }],
    eventJournal: [...world.eventJournal, { eventId: buildingEventId, seq: world.eventJournal.length + 1,
      type: 'BuildingSceneInitialized', actorId: playerId, visibility: 'private', worldTimeMinutes: 0,
      targetIds: [route.roomId, route.corridorId], payload: { rule: 'building-scene-v1', scene: 'abandoned-residential-building-v1',
        playerId, roomId: route.roomId, corridorId: route.corridorId,
        routeSourceEventId: 'evt-initial-route', pickupSourceEventId: 'evt-initial-pickup' } }],
  });
}
export function createBuildingPrototype(seed = 1): WorldState { return addBuildingScene(createPickupPrototype(seed)); }
export function createBuildingGame(...args: Parameters<typeof createPickupGame>): WorldState { return addBuildingScene(createPickupGame(...args)); }
