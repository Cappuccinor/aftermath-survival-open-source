import { z } from 'zod';
import { clockSchema, idSchema, integerSchema } from './schema';
import type { DeepReadonly } from './schema';
export const searchReceiptSchema = z.strictObject({
 rule:z.literal('search-v1'),commandId:idSchema,
 request:z.strictObject({actorId:idSchema,locationId:idSchema,expectedWorldRevision:integerSchema}),
 elapsedMinutes:z.literal(1),committedRevision:integerSchema.min(1),observedAt:clockSchema,discoveredItemId:idSchema.nullable(),
});
export type SearchReceipt = DeepReadonly<z.infer<typeof searchReceiptSchema>>;
export const discoverySchema=z.strictObject({rule:z.literal('search-discovery-v1'),commandId:idSchema,itemId:idSchema,locationId:idSchema,observedAt:clockSchema});
export const searchScopeSchema=z.strictObject({rule:z.literal('search-scope-v1'),locationId:idSchema,itemId:idSchema});
