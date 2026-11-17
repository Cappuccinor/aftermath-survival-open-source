import { z } from 'zod';
import { idSchema, integerSchema, jsonRecordSchema } from './schema';
export const positionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('player'), id: idSchema }),
  z.strictObject({ kind: z.literal('location'), id: idSchema }),
  z.strictObject({ kind: z.literal('container'), id: idSchema }),
  z.strictObject({ kind: z.literal('npc'), id: idSchema }),
]);
export const itemSchema = z.strictObject({
  itemId: idSchema, typeId: idSchema, position: positionSchema,
  count: integerSchema.min(1), weightKg: z.number().nonnegative(),
  durability: z.number().min(0).max(100), condition: z.string(), metadata: jsonRecordSchema,
});
