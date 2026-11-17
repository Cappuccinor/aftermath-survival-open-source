import { z } from 'zod';
import { idSchema, integerSchema, clockSchema } from './schema';
import type { DeepReadonly } from './schema';
import type { PickupWorld } from './pickup-model';
export interface CabinetWorld extends PickupWorld {
  readonly locations: Readonly<Record<string, { readonly light: number; readonly adjacentLocationIds: readonly string[] }>>;
}
export const cabinetId = 'prototype-cabinet', waterId = 'prototype-bottled-water';
export const cabinetScopeId = 'evt-initial-cabinet', cabinetKnownFact = 'cabinet-known';
export const cabinetDiscoveryFact = `cabinet-discovery-${waterId}`;
export const cabinetSearchEventId = (id: string) => `evt-${id}-cabinet-search`;
export const cabinetDiscoveryEventId = (id: string) => `evt-${id}-cabinet-discovery`;
export const cabinetSearchFact = `cabinet-search-${cabinetId}`;
export const cabinetScopeSchema = z.strictObject({ rule: z.literal('cabinet-scope-v1'), playerId: idSchema,
  locationId: idSchema, cabinetId: z.literal(cabinetId), waterId: z.literal(waterId),
  buildingSourceEventId: z.literal('evt-initial-building-scene') });
export const cabinetReceiptSchema = z.strictObject({ rule: z.literal('cabinet-search-v1'), commandId: idSchema,
  request: z.strictObject({ actorId: idSchema, locationId: idSchema, cabinetId: z.literal(cabinetId), expectedWorldRevision: integerSchema }),
  elapsedMinutes: z.literal(1), committedRevision: integerSchema.min(1), observedAt: clockSchema,
  discoveredItemId: z.literal(waterId).nullable() });
export type CabinetReceipt = DeepReadonly<z.infer<typeof cabinetReceiptSchema>>;
export const cabinetDiscoverySchema = z.strictObject({ rule: z.literal('cabinet-discovery-v1'), commandId: idSchema,
  itemId: z.literal(waterId), cabinetId: z.literal(cabinetId), locationId: idSchema, observedAt: clockSchema });
export const cabinetTimeSchema = z.strictObject({ rule: z.literal('cabinet-search-v1'), commandId: idSchema,
  fromMinutes: clockSchema, toMinutes: clockSchema, fromRevision: integerSchema, toRevision: integerSchema.min(1) });
export function cabinetItems(locationId: string) {
  return {
    [cabinetId]: { itemId: cabinetId, typeId: 'wooden-cabinet', position: { kind: 'location' as const, id: locationId }, count: 1, weightKg: 20, durability: 100, condition: 'intact', metadata: {} },
    [waterId]: { itemId: waterId, typeId: 'bottled-water', position: { kind: 'container' as const, id: cabinetId }, count: 1, weightKg: .5, durability: 100, condition: 'sealed', metadata: {} },
  };
}
