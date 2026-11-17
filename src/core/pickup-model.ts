import { z } from 'zod';
import { clockSchema, idSchema, integerSchema } from './schema';
import type { DeepReadonly } from './schema';
import type { WorldEvent } from './events';
import { itemSchema } from './item-model';
export const pickupScopeSchema=z.strictObject({rule:z.literal('pickup-scope-v1'),playerId:idSchema,locationId:idSchema,
  searchSourceEventId:z.literal('evt-initial-search'),initialCarryWeightKg:z.literal(0),initialItem:itemSchema});
export const pickupReceiptSchema=z.strictObject({rule:z.literal('pick_up-v1'),commandId:idSchema,
  request:z.strictObject({actorId:idSchema,locationId:idSchema,itemId:idSchema,expectedWorldRevision:integerSchema}),
  elapsedMinutes:z.literal(1),committedRevision:integerSchema.min(1),observedAt:clockSchema,
  from:z.strictObject({kind:z.literal('location'),id:idSchema}),to:z.strictObject({kind:z.literal('player'),id:idSchema}),
  count:z.literal(1),weightKg:z.literal(.05),beforeCarryWeightKg:z.literal(0),afterCarryWeightKg:z.literal(.05),perceptionSourceEventId:idSchema});
export const pickupTimeSchema=z.strictObject({rule:z.literal('pick_up-v1'),commandId:idSchema,
  fromMinutes:clockSchema,toMinutes:clockSchema,fromRevision:integerSchema,toRevision:integerSchema.min(1)});
export type PickupReceipt=DeepReadonly<z.infer<typeof pickupReceiptSchema>>;
export type PickupScope=DeepReadonly<z.infer<typeof pickupScopeSchema>>;
export interface PickupWorld {
  readonly campaign:{readonly gameClockMinutes:number;readonly worldRevision:number};
  readonly player:{readonly playerId:string;readonly locationId:string;readonly knownFactIds:readonly string[];
    readonly stats:Readonly<Record<string,number>> & {readonly hp:number;readonly carryWeightKg:number}};
  readonly items:Readonly<Record<string,DeepReadonly<z.infer<typeof itemSchema>>>>;
  readonly locations:Readonly<Record<string,{readonly light:number}>>;
  readonly eventJournal:readonly WorldEvent[];
  readonly knowledge:readonly {readonly factId:string;readonly knowerId:string;readonly source:string;readonly confidence:number;readonly observedAt:number;readonly expiresAt?:number|undefined}[];
}
export const pickupScopeEventId='evt-initial-pickup';
export const pickupEventId=(id:string)=>`evt-${id}-pickup`;
export const pickupFactId=(id:string)=>`pickup-${id}`;
