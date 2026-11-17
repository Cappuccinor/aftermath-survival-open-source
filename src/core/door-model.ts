import type { LifecycleWitness } from './npc-lifecycle-model';
import { z } from 'zod';
import { clockSchema, idSchema, integerSchema } from './schema';
import type { DeepReadonly } from './schema';
import { rngStateSchema } from './rng';
import type { RngState } from './rng';
import type { WorldEvent } from './events';

const scale = z.number().min(0).max(100);
const alertness = integerSchema.max(100);
export const doorWitnessSchema = z.strictObject({
  kind: z.literal('g1-door-witness-v1'), npcId: idSchema, locationId: idSchema,
  appearance: z.literal('worn-shoes-v1'), alertness,
  firstNoticed: z.strictObject({ playerId: idSchema, locationId: idSchema, observedAt: clockSchema, sourceEventId: idSchema }).nullable(),
});
export const doorScopeSchema = z.strictObject({
  rule: z.literal('door-gap-scope-v1'), doorId: idSchema, roomId: idSchema, corridorId: idSchema, npcId: idSchema,
  gapOpen: z.boolean(), initialAlertness: alertness, initialRng: rngStateSchema,
  perception: scale, stealth: scale, corridorLight: z.number().min(0).max(1),
});
export const doorReceiptSchema = z.strictObject({
  rule: z.literal('door-observe-v1'), commandId: idSchema,
  request: z.strictObject({ actorId: idSchema, locationId: idSchema, doorId: idSchema, expectedWorldRevision: integerSchema }),
  elapsedMinutes: z.literal(1), committedRevision: integerSchema.min(1), observedAt: clockSchema,
  visual: z.enum(['none', 'shadow', 'shoes']), noticed: z.boolean(), beforeAlertness: alertness, afterAlertness: alertness,
  visualRoll: z.number().min(0).lt(1), noticeRoll: z.number().min(0).lt(1), rngBefore: rngStateSchema, rngAfter: rngStateSchema,
});
export const doorNoticeSchema = z.strictObject({ rule: z.literal('door-notice-v1'), commandId: idSchema,
  npcId: idSchema, playerId: idSchema, locationId: idSchema, observedAt: clockSchema, fromAlertness: alertness, toAlertness: alertness });
export const doorSoundSchema = z.strictObject({ rule: z.literal('door-reaction-v1'), commandId: idSchema,
  doorId: idSchema, npcId: idSchema, observedAt: clockSchema, cue: z.literal('cloth-rustle-v1') });
export type DoorWitness = DeepReadonly<z.infer<typeof doorWitnessSchema>>;
export type DoorScope = DeepReadonly<z.infer<typeof doorScopeSchema>>;
export type DoorReceipt = DeepReadonly<z.infer<typeof doorReceiptSchema>>;
/** Structural view avoids a runtime or schema-inference cycle with world validation. */
export interface DoorWorld {
  readonly stateSchema?: string;
  readonly campaign: { readonly seed: number; readonly gameClockMinutes: number; readonly worldRevision: number };
  readonly player: { readonly playerId: string; readonly locationId: string; readonly knownFactIds: readonly string[];
    readonly skills: Readonly<Record<string, number>>; readonly stats: { readonly hp: number } };
  readonly locations: Readonly<Record<string, { readonly light: number; readonly adjacentLocationIds: readonly string[] }>>;
  readonly items: Readonly<Record<string, unknown>>;
  readonly npcs: readonly (DoorWitness | LifecycleWitness)[];
  readonly rngState: RngState;
  readonly eventJournal: readonly WorldEvent[];
  readonly knowledge: readonly { readonly knowerId: string; readonly factId: string; readonly source: string;
    readonly confidence: number; readonly observedAt: number; readonly expiresAt?: number | undefined }[];
}
