import { z } from 'zod';
import { clockSchema, idSchema, integerSchema } from './schema';
import type { DeepReadonly } from './schema';

const requestSchema = z.strictObject({
  actorId: idSchema, locationId: idSchema, expectedWorldRevision: integerSchema,
});
export const observationReceiptSchema = z.strictObject({
  rule: z.literal('observe-v1'), commandId: idSchema, request: requestSchema,
  visibility: z.enum(['dark', 'clear']), elapsedMinutes: z.literal(1),
  committedRevision: integerSchema.min(1), observedAt: clockSchema,
});

export type ObservationRequest = DeepReadonly<z.infer<typeof requestSchema>>;
export type ObservationReceipt = DeepReadonly<z.infer<typeof observationReceiptSchema>>;

export function observationEventId(commandId: string) { return `evt-${commandId}-observation`; }
export function observationFactId(locationId: string) { return `sight-${locationId}-light`; }
export function observationVisibility(light: number) { return light >= 0.5 ? 'clear' as const : 'dark' as const; }
