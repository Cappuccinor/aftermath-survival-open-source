import { z } from 'zod';
import { idSchema, integerSchema, clockSchema } from './schema';
import type { DeepReadonly } from './schema';
import { itemSchema, positionSchema } from './item-model';
import { cabinetReceiptSchema } from './cabinet-model';
export const transferScopeId = 'evt-initial-transfer';
export const transferScopeSchema = z.strictObject({ rule: z.literal('dual-transfer-scope-v1'), playerId: idSchema, locationId: idSchema,
  pickupSourceEventId: z.literal('evt-initial-pickup'), cabinetSourceEventId: z.literal('evt-initial-cabinet'),
  initialCarryWeightKg: z.literal(0), initialTin: itemSchema, initialWater: itemSchema });
export const transferReceiptSchema = z.strictObject({ rule: z.literal('pick_up-v2'), commandId: idSchema,
  request: z.strictObject({ actorId: idSchema, locationId: idSchema, itemId: z.enum(['prototype-tin', 'prototype-bottled-water']), expectedWorldRevision: integerSchema }),
  elapsedMinutes: z.literal(1), observedAt: clockSchema, committedRevision: integerSchema.min(1),
  from: positionSchema, to: z.strictObject({ kind: z.literal('player'), id: idSchema }), count: z.literal(1),
  weightKg: z.union([z.literal(.05), z.literal(.5)]), beforeCarryWeightKg: z.number().nonnegative(), afterCarryWeightKg: z.number().nonnegative(),
  perceptionSourceEventId: idSchema });
export type TransferReceipt = DeepReadonly<z.infer<typeof transferReceiptSchema>>;
export const transferTimeSchema = z.strictObject({ rule: z.literal('pick_up-v2'), commandId: idSchema,
  fromMinutes: clockSchema, toMinutes: clockSchema, fromRevision: integerSchema, toRevision: integerSchema.min(1) });
export const cabinetSearchV2Schema = cabinetReceiptSchema.extend({ rule: z.literal('cabinet-search-v2'), waterLocation: z.enum(['cabinet', 'player']) });
export type CabinetSearchV2 = DeepReadonly<z.infer<typeof cabinetSearchV2Schema>>;
export const transferEventId = (id: string) => `evt-${id}-transfer`;
export const transferFactId = (id: string) => `transfer-${id}`;
