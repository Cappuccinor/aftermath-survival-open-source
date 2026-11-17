import { z } from 'zod';
import { idSchema, integerSchema, jsonRecordSchema, freezeSnapshot } from './schema';
import type { DeepReadonly } from './schema';

const commandSchema = z.strictObject({
  commandId: idSchema,
  actorId: idSchema,
  source: z.enum(['button', 'text', 'voice', 'scheduler']),
  verb: z.string().trim().min(1),
  targetIds: z.array(idSchema),
  toolIds: z.array(idSchema),
  arguments: jsonRecordSchema,
  utterance: z.string(),
  expectedWorldRevision: integerSchema,
});

export type Command = DeepReadonly<z.infer<typeof commandSchema>>;

/** Envelope validation only. No primitive registry, permissions or execution yet. */
export function parseCommand(input: unknown): Command {
  return freezeSnapshot(commandSchema.parse(input));
}
