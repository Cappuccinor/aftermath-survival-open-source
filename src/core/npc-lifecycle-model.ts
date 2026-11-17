import { z } from 'zod';
import { doorWitnessSchema, doorReceiptSchema } from './door-model';
import { idSchema } from './schema';
import type { DeepReadonly } from './schema';

export const lifecycleId = 'evt-initial-npc-lifecycle';
export const lifeSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('alive') }),
  z.strictObject({ status: z.literal('dead'), source: z.literal('pre-game-fixture-v1'),
    cause: z.literal('unspecified-pre-game-death'), atGameMinutes: z.literal(-1) }),
]);
export const lifecycleWitnessSchema = doorWitnessSchema.extend({ kind: z.literal('g1-static-witness-v2'), life: lifeSchema });
export const lifecycleScopeSchema = z.strictObject({ rule: z.literal('npc-lifecycle-scope-v1'), playerId: idSchema,
  hiddenSourceEventId: z.literal('evt-initial-npc-hidden-item'), initialNpc: lifecycleWitnessSchema });
export const deadDoorReceiptSchema = doorReceiptSchema.extend({ rule: z.literal('door-observe-v2'),
  noticed: z.literal(false), noticeRoll: z.null(), noticeCapability: z.literal('absent') });
export const anyDoorReceiptSchema = z.discriminatedUnion('rule', [doorReceiptSchema, deadDoorReceiptSchema]);
export type LifecycleWitness = DeepReadonly<z.infer<typeof lifecycleWitnessSchema>>;
export type DeadDoorReceipt = DeepReadonly<z.infer<typeof deadDoorReceiptSchema>>;
