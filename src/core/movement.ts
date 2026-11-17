import { z } from 'zod';
import { clockSchema, idSchema, integerSchema } from './schema';
import type { DeepReadonly } from './schema';
import type { WorldState } from './world';
export const movementReceiptSchema = z.strictObject({
 rule: z.literal('move-v1'), commandId: idSchema,
 request: z.strictObject({ actorId: idSchema, locationId: idSchema, destinationId: idSchema, expectedWorldRevision: integerSchema }),
 elapsedMinutes: z.literal(1), committedRevision: integerSchema.min(1), observedAt: clockSchema,
});
export type MovementReceipt = DeepReadonly<z.infer<typeof movementReceiptSchema>>;
export const routeSchema = z.strictObject({ rule: z.literal('known-route-v1'), roomId: idSchema, corridorId: idSchema });
export function knownRoute(world: WorldState) {
 const event = world.eventJournal.find(e => e.eventId === 'evt-initial-route');
 const parsed = routeSchema.safeParse(event?.payload);
 if (!event || !parsed.success) return;
 const { roomId, corridorId } = parsed.data;
 const fact = world.knowledge.find(k => k.factId === 'known-prototype-route');
 if (roomId === corridorId || event.type !== 'KnownRouteInitialized' || event.actorId !== world.player.playerId
 || event.worldTimeMinutes !== 0 || event.visibility !== 'private' || event.targetIds.length !== 2
 || event.targetIds[0] !== roomId || event.targetIds[1] !== corridorId
 || !world.player.knownFactIds.includes('known-prototype-route') || !fact || fact.source !== event.eventId
 || fact.confidence !== 1 || fact.observedAt !== 0 || fact.expiresAt !== undefined
 || !world.locations[roomId]?.adjacentLocationIds.includes(corridorId)
 || !world.locations[corridorId]?.adjacentLocationIds.includes(roomId)) return;
 return parsed.data;
}
export function canMove(world: WorldState, from: string, to: string) {
 const route = knownRoute(world);
 return !!route && ((from === route.roomId && to === route.corridorId) || (from === route.corridorId && to === route.roomId));
}
export function projectLocation(world: WorldState, id = world.player.locationId) {
 const route = knownRoute(world);
 if (!route || (id !== route.roomId && id !== route.corridorId)) return null;
 return Object.freeze({ targetId: id, label: id === route.roomId ? '房间' : '走廊' });
}
export function visibleRoutes(world: WorldState) {
 const route = knownRoute(world);
 if (!route || world.player.stats.hp === 0) return Object.freeze([]);
 const id = world.player.locationId === route.roomId ? route.corridorId : route.roomId;
 const target = canMove(world, world.player.locationId, id) ? projectLocation(world, id) : null;
 return Object.freeze(target ? [target] : []);
}
