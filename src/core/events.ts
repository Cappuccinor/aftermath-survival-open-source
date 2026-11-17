import { z } from 'zod';
import { idSchema, integerSchema, clockSchema, jsonRecordSchema, freezeSnapshot } from './schema';
import type { DeepReadonly } from './schema';

export const worldEventSchema = z.strictObject({
  eventId: idSchema,
  seq: integerSchema.min(1),
  worldTimeMinutes: clockSchema,
  type: z.string().trim().min(1),
  actorId: idSchema.nullable(),
  targetIds: z.array(idSchema),
  payload: jsonRecordSchema,
  visibility: z.enum(['private', 'public']),
});

export const eventJournalSchema = z.array(worldEventSchema).superRefine((events, ctx) => {
  const ids = new Set<string>();
  let lastTime = 0;
  for (const [index, event] of events.entries()) {
    if (ids.has(event.eventId) || event.seq !== index + 1 || event.worldTimeMinutes < lastTime) {
      ctx.addIssue({ code: 'custom', message: 'Invalid event identity, sequence or time', path: [index] });
    }
    ids.add(event.eventId);
    lastTime = event.worldTimeMinutes;
  }
});
export type WorldEvent = DeepReadonly<z.infer<typeof worldEventSchema>>;

/** Validates journal structure; does not authorize or apply event payloads. */
export function parseEventJournal(input: unknown): readonly WorldEvent[] {
  return freezeSnapshot(eventJournalSchema.parse(input));
}
