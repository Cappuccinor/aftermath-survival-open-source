import { discoverySchema } from './search';
import { z } from 'zod';
import { clockSchema, idSchema, integerSchema } from './schema';
import type { DeepReadonly } from './schema';
import type { WorldState } from './world';
import { itemPositionAt } from './pickup-history';

export const inspectionReceiptSchema = z.strictObject({
  rule: z.literal('inspect-v1'), commandId: idSchema,
  request: z.strictObject({ actorId: idSchema, locationId: idSchema, itemId: idSchema, expectedWorldRevision: integerSchema }),
  appearance: z.literal('open-metal-tin-v1'), elapsedMinutes: z.literal(1),
  committedRevision: integerSchema.min(1), observedAt: clockSchema,
});
export type InspectionReceipt = DeepReadonly<z.infer<typeof inspectionReceiptSchema>>;
const initialSightSchema = z.strictObject({
  rule: z.literal('initial-sight-v1'), itemId: idSchema, locationId: idSchema, observedAt: z.literal(0),
});
export const tinAppearance = Object.freeze({ label: '空罐', description: '罐身呈金属质感，罐口敞开。' });
export function seenItemFactId(itemId: string) { return `seen-item-${itemId}`; }
export function initialSightingId(itemId: string) { return `evt-init-${itemId}-sighting`; }
export function inspectionFactId(itemId: string) { return `inspection-${itemId}-appearance`; }
export function inspectionEventId(commandId: string) { return `evt-${commandId}-inspection`; }

/** Initial or search-discovery evidence must satisfy historical time and event-sequence bounds. */
export function canPerceiveInspectableItem(world: WorldState, itemId: string, at = world.campaign.gameClockMinutes, locationId = world.player.locationId, beforeSeq = Infinity): boolean {
  if (!Object.hasOwn(world.items, itemId)) return false;
  const item = world.items[itemId]!;
  const position = itemPositionAt(world, itemId, beforeSeq);
  if (item.typeId !== 'empty-tin' || position?.kind !== 'location' || position.id !== locationId
    || world.locations[locationId]!.light < 0.5) return false;
  const factId = seenItemFactId(itemId);
  const knowledge = world.knowledge.find(fact => fact.factId === factId);
  if (!world.player.knownFactIds.includes(factId) || !knowledge || knowledge.knowerId !== world.player.playerId
    || knowledge.confidence !== 1
    || knowledge.observedAt > at || (knowledge.expiresAt !== undefined && knowledge.expiresAt <= at)) return false;
  const event = world.eventJournal.find(entry => entry.eventId === knowledge.source);
  if (event?.type === 'ItemDiscovered') {
    const parsed=discoverySchema.safeParse(event.payload);
    return parsed.success && event.seq < beforeSeq && event.actorId===world.player.playerId && event.visibility==='private'
      && event.targetIds.length===1 && event.targetIds[0]===itemId && event.worldTimeMinutes===knowledge.observedAt
      && parsed.data.observedAt===knowledge.observedAt && parsed.data.itemId===itemId && parsed.data.locationId===locationId;
  }
  if (knowledge.source!==initialSightingId(itemId)||knowledge.observedAt!==0) return false;
  if (!event || event.seq >= beforeSeq || event.type !== 'ItemInitiallyPerceived' || event.actorId !== world.player.playerId
    || event.visibility !== 'private' || event.worldTimeMinutes !== 0
    || event.targetIds.length !== 1 || event.targetIds[0] !== itemId) return false;
  const parsed = initialSightSchema.safeParse(event.payload);
  return parsed.success && parsed.data.itemId === itemId && parsed.data.locationId === position.id;
}

export function visibleInspectionTargets(world: WorldState): readonly { readonly targetId: string; readonly label: string }[] {
  if (world.player.stats.hp === 0) return Object.freeze([]);
  return Object.freeze(Object.keys(world.items).filter(id => canPerceiveInspectableItem(world, id))
    .map(id => Object.freeze({ targetId: id, label: tinAppearance.label })));
}
