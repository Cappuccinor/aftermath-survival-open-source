import { z } from 'zod';
import { clockSchema, idSchema, integerSchema, jsonRecordSchema } from './schema';
import type { DeepReadonly } from './schema';
import type { DoorWorld } from './door-model';
import type { WorldEvent } from './events';

export const contactRelationSchema = z.strictObject({ kind: z.literal('g2-contact-relation-v1'),
  fromNpcId: idSchema, toPlayerId: idSchema, hostility: integerSchema.max(100),
  stance: z.enum(['wary', 'avoidant']), firstSourceEventId: idSchema, lastSourceEventId: idSchema });
export const contactMemorySchema = z.strictObject({ kind: z.literal('g2-contact-memory-v1'),
  npcId: idSchema, playerId: idSchema, fact: z.enum(['warning_given', 'warning_ignored']),
  sourceEventId: idSchema, locationId: idSchema, observedAt: clockSchema });
export const contactReceiptSchema = z.strictObject({ rule: z.literal('talk-v1'), commandId: idSchema,
  request: z.strictObject({ actorId: idSchema, locationId: idSchema, expectedWorldRevision: integerSchema, topic: z.literal('greeting') }),
  elapsedMinutes: z.literal(1), committedRevision: integerSchema.min(1), observedAt: clockSchema,
  result: z.enum(['no_response', 'first_warning', 'repeated_warning', 'silence_after_warning']),
  npcId: idSchema.nullable(), alertnessBefore: integerSchema.max(100).optional() });
export type ContactRelation = DeepReadonly<z.infer<typeof contactRelationSchema>>;
export type ContactMemory = DeepReadonly<z.infer<typeof contactMemorySchema>>;
export type ContactReceipt = DeepReadonly<z.infer<typeof contactReceiptSchema>>;
export interface ContactWorld extends DoorWorld {
  readonly stateSchema: string;
  readonly relationships: readonly ContactRelation[];
  readonly npcMemories?: readonly ContactMemory[];
}
export const contactTypes = new Set(['GreetingRecorded', 'NPCContactResponse', 'NPCContactMemoryRecorded', 'NPCContactRelationChanged', 'PlayerContactHeard']);
export const npcContactTypes = new Set(['NPCContactResponse', 'NPCContactMemoryRecorded', 'NPCContactRelationChanged']);
export const isContactEvent = (e: WorldEvent) => contactTypes.has(e.type)
  || e.payload.rule === 'talk-v1' || (typeof e.payload.rule === 'string' && e.payload.rule.startsWith('contact-'));
export const contactEventId = (id: string, suffix = 'greeting') => `evt-${id}-${suffix}`;
export const contactFactId = (npc: string) => `contact-heard-${npc}`;
export function contactCanonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(contactCanonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${contactCanonical((value as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

/** Deterministic, local hearing only. No RNG and no inspection of unwitnessed player actions. */
export function judgeContact(npc: DoorWorld['npcs'][number] | undefined, location: string, relation: ContactRelation | undefined) {
  if (!npc || npc.locationId !== location || npc.kind !== 'g1-static-witness-v2' || npc.life.status !== 'alive')
    return { result: 'no_response' as const, npcId: null };
  if (!relation) return { result: 'first_warning' as const, npcId: npc.npcId, alertnessBefore: npc.alertness };
  return { result: relation.hostility === 20 || relation.hostility === 60 ? 'repeated_warning' as const : 'silence_after_warning' as const, npcId: npc.npcId };
}

/** Build the exact event group; validation rebuilds it at the historical cursor. */
export function contactGroup(receipt: ContactReceipt, seq: number, prior: ContactRelation | undefined) {
  const { commandId, request, observedAt, committedRevision, result, npcId } = receipt;
  const envelope = { worldTimeMinutes: observedAt, actorId: request.actorId, targetIds: [request.locationId], visibility: 'private' as const };
  const events: WorldEvent[] = [
    { ...envelope, eventId: contactEventId(commandId, 'time'), seq, type: 'TimeAdvanced', payload: {
      rule: 'talk-v1', commandId, fromMinutes: observedAt - 1, toMinutes: observedAt,
      fromRevision: request.expectedWorldRevision, toRevision: committedRevision } },
    { ...envelope, eventId: contactEventId(commandId), seq: seq + 1, type: 'GreetingRecorded', payload: jsonRecordSchema.parse(receipt) },
  ];
  if (result === 'no_response' || result === 'silence_after_warning') return { events, relation: null, memory: null, perception: null };
  if (!npcId) throw Error('Missing contact witness');
  const first = result === 'first_warning', low = receipt.alertnessBefore !== undefined && receipt.alertnessBefore < 50;
  if (!first && !prior) throw Error('Missing prior warning');
  const source = contactEventId(commandId, 'contact-response'), relationSource = contactEventId(commandId, 'contact-relation');
  const responseCode = first ? (low ? 'first_warning_wary' : 'first_warning_avoidant') : 'repeated_warning';
  const memory: ContactMemory = { kind: 'g2-contact-memory-v1', npcId, playerId: request.actorId,
    fact: first ? 'warning_given' : 'warning_ignored', sourceEventId: source, locationId: request.locationId, observedAt };
  const relation: ContactRelation = { kind: 'g2-contact-relation-v1', fromNpcId: npcId, toPlayerId: request.actorId,
    hostility: first ? (low ? 20 : 60) : prior!.hostility + 20, stance: first && low ? 'wary' : 'avoidant',
    firstSourceEventId: prior?.firstSourceEventId ?? relationSource, lastSourceEventId: relationSource };
  const npcEnvelope = { ...envelope, actorId: npcId, targetIds: [request.actorId, request.locationId] };
  const shared = { commandId, npcId, playerId: request.actorId, locationId: request.locationId, observedAt };
  events.push(
    { ...npcEnvelope, eventId: source, seq: seq + 2, type: 'NPCContactResponse', payload: { rule: 'contact-response-v1', ...shared, responseCode } },
    { ...npcEnvelope, eventId: contactEventId(commandId, 'contact-memory'), seq: seq + 3, type: 'NPCContactMemoryRecorded', payload: { rule: 'contact-memory-v1', ...shared, memory } },
    { ...npcEnvelope, eventId: relationSource, seq: seq + 4, type: 'NPCContactRelationChanged', payload: { rule: 'contact-relation-v1', ...shared, before: prior ?? null, after: relation } },
    { ...envelope, eventId: contactEventId(commandId, 'contact-heard'), seq: seq + 5, type: 'PlayerContactHeard', payload: {
      rule: 'contact-perception-v1', ...shared, sourceEventId: source, factId: contactFactId(npcId), responseCode } },
  );
  const perception = { knowerId: request.actorId, factId: contactFactId(npcId), source: contactEventId(commandId, 'contact-heard'), confidence: 1, observedAt };
  return { events, relation, memory, perception };
}
