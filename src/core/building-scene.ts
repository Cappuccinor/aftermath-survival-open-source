import { z } from 'zod';
import { idSchema } from './schema';
import type { PickupWorld } from './pickup-model';
import { readPickupHistory } from './pickup-history';
import { routeSchema } from './movement';

export const buildingEventId = 'evt-initial-building-scene';
export const buildingFactId = 'known-building-scene';
const buildingSchema = z.strictObject({
  rule: z.literal('building-scene-v1'), scene: z.literal('abandoned-residential-building-v1'),
  playerId: idSchema, roomId: idSchema, corridorId: idSchema,
  routeSourceEventId: z.literal('evt-initial-route'), pickupSourceEventId: z.literal('evt-initial-pickup'),
});
interface BuildingWorld extends PickupWorld {
  readonly locations: Readonly<Record<string, { readonly light: number; readonly adjacentLocationIds: readonly string[] }>>;
}
function ensure(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid building scene: ${message}`);
}

/** Optional identity proven by one initialization and one player's initial knowledge record. */
export function readBuildingScene(world: BuildingWorld) {
  const reserved = world.eventJournal.filter(e => e.eventId === buildingEventId || e.type === 'BuildingSceneInitialized'
    || (typeof e.payload.rule === 'string' && e.payload.rule.startsWith('building-scene-')));
  const relatedKnowledge = world.knowledge.filter(k => k.factId.startsWith(buildingFactId) || k.source === buildingEventId);
  const relatedIds = world.player.knownFactIds.filter(id => id.startsWith(buildingFactId));
  if (!reserved.length) {
    ensure(!relatedKnowledge.length && !relatedIds.length, 'orphan knowledge');
    return null;
  }
  ensure(reserved.length === 1, 'duplicate or unknown initialization');
  const init = reserved[0]!, scope = buildingSchema.parse(init.payload);
  const { roomId, corridorId } = scope, player = world.player.playerId;
  ensure(init.eventId === buildingEventId && init.type === 'BuildingSceneInitialized', 'event identity');
  ensure(init.actorId === player && scope.playerId === player && init.visibility === 'private'
    && init.worldTimeMinutes === 0, 'initial actor/time/visibility');
  ensure(init.targetIds.length === 2 && init.targetIds[0] === roomId && init.targetIds[1] === corridorId, 'targets');

  const room = world.locations[roomId], corridor = world.locations[corridorId];
  ensure(roomId !== corridorId && !!room && !!corridor && Object.keys(world.locations).length === 2, 'two existing places');
  ensure(room.adjacentLocationIds.length === 1 && room.adjacentLocationIds[0] === corridorId
    && corridor.adjacentLocationIds.length === 1 && corridor.adjacentLocationIds[0] === roomId, 'known connection');

  const route = world.eventJournal.find(e => e.eventId === scope.routeSourceEventId);
  const routeData = routeSchema.parse(route?.payload);
  ensure(!!route && route.seq < init.seq && route.type === 'KnownRouteInitialized' && route.actorId === player
    && route.visibility === 'private' && route.worldTimeMinutes === 0, 'route initialization');
  ensure(route.targetIds.length === 2 && route.targetIds[0] === roomId && route.targetIds[1] === corridorId
    && routeData.roomId === roomId && routeData.corridorId === corridorId, 'route roles');
  const routeKnowledge = world.knowledge.find(k => k.factId === 'known-prototype-route');
  ensure(!!routeKnowledge && routeKnowledge.knowerId === player && routeKnowledge.source === route.eventId
    && routeKnowledge.confidence === 1 && routeKnowledge.observedAt === 0 && routeKnowledge.expiresAt === undefined
    && world.player.knownFactIds.includes(routeKnowledge.factId), 'route knowledge');

  const pickup = world.eventJournal.find(e => e.eventId === scope.pickupSourceEventId);
  const history = readPickupHistory(world);
  ensure(!!pickup && pickup.seq + 1 === init.seq && !!history && history.scope.locationId === roomId, 'pickup initialization order');
  ensure(world.eventJournal.every(e => e.type !== 'TimeAdvanced' || e.seq > init.seq), 'initialization before actions');
  ensure(world.player.locationId === roomId || world.player.locationId === corridorId, 'current place');

  ensure(relatedKnowledge.length === 1 && relatedIds.length === 1 && relatedIds[0] === buildingFactId, 'single known identity');
  const knowledge = relatedKnowledge[0]!;
  ensure(knowledge.factId === buildingFactId && knowledge.knowerId === player && knowledge.source === init.eventId
    && knowledge.confidence === 1 && knowledge.observedAt === 0 && knowledge.expiresAt === undefined, 'identity evidence');
  return Object.freeze(scope);
}
