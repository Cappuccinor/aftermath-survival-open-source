import { readTransferHistory } from './transfer-history';
import { z } from 'zod';
import { freezeSnapshot } from './schema';
import type { WorldEvent } from './events';
import type { PickupWorld } from './pickup-model';
import { readPickupHistory } from './pickup-history';

const text = z.string().refine(value => [...value].length <= 240, '最多 240 个字符');
const name = z.string().trim().refine(value => [...value].length >= 1 && [...value].length <= 40, '姓名须为 1–40 个字符');
const profileSchema = z.strictObject({
  name, age: z.number().int().min(1).max(120), gender: text, occupation: text,
  locationBackground: text, bodyCondition: text, personality: text, strengths: text,
  weaknesses: text, importantItems: text, companions: text, importantPerson: text, fear: text, wish: text,
});
const skill = z.number().int().min(0).max(30);
const skillsSchema = z.strictObject({ perception: skill, stealth: skill, survival: skill })
  .refine(value => value.perception + value.stealth + value.survival <= 60, '技能总和不能超过 60');
const inputSchema = z.strictObject({ profile: profileSchema, skills: skillsSchema });
export type CharacterInput = z.infer<typeof inputSchema>;
export type CharacterProfile = ReturnType<typeof parseCharacterInput>;
export const initialCharacterStats = Object.freeze({ hp: 100, stamina: 100, mental: 100, hunger: 0,
  thirst: 0, fatigue: 0, infection: 0, pain: 0, bodyTempC: 37, carryWeightKg: 0 });

/** Require own data fields: inherited values must not grant creation authority. */
function ownFields(value: unknown, keys: readonly string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || keys.some(key => !Object.hasOwn(value, key))) throw new Error('Missing character fields');
}
export function parseCharacterInput(input: unknown) {
  ownFields(input, ['profile', 'skills']);
  const value = input as Record<string, unknown>;
  ownFields(value.profile, Object.keys(profileSchema.shape));
  ownFields(value.skills, ['perception', 'stealth', 'survival']);
  return freezeSnapshot(inputSchema.parse(input));
}

const recordSchema = z.strictObject({
  rule: z.literal('character-created-v1'), initialRule: z.literal('character-start-v1'),
  profile: profileSchema, skills: skillsSchema,
  initialStats: z.strictObject({ hp: z.literal(100), stamina: z.literal(100), mental: z.literal(100), hunger: z.literal(0),
    thirst: z.literal(0), fatigue: z.literal(0), infection: z.literal(0), pain: z.literal(0), bodyTempC: z.literal(37), carryWeightKg: z.literal(0) }),
  startLocationId: z.literal('prototype-location'),
});
interface CharacterWorld extends PickupWorld {
  readonly campaign: { readonly gameClockMinutes: number; readonly worldRevision: number };
  readonly player: PickupWorld['player'] & { readonly background: string; readonly skills: Readonly<Record<string, number>> };
  readonly eventJournal: readonly WorldEvent[];
}
function creationRecord(world: CharacterWorld) {
  const records = world.eventJournal.filter(event => event.type === 'CharacterCreated'
    || event.eventId === 'evt-character-created' || (typeof event.payload.rule === 'string' && event.payload.rule.startsWith('character-created-')));
  if (records.length === 0) return null; // Legacy prototypes retain their existing semantics.
  const event = records[0]!;
  if (records.length !== 1 || event.type !== 'CharacterCreated' || event.eventId !== 'evt-character-created'
    || event.seq !== 1 || event.worldTimeMinutes !== 0 || event.actorId !== world.player.playerId
    || event.visibility !== 'private' || event.targetIds.length !== 1 || event.targetIds[0] !== world.player.playerId) {
    throw new Error('Inconsistent character creation record');
  }
  const payload = recordSchema.parse(event.payload);
  if ((event.payload.profile as Record<string, unknown>).name !== payload.profile.name) throw new Error('Noncanonical character name');
  const actions = world.eventJournal.filter(entry => entry.type === 'TimeAdvanced');
  if (world.campaign.gameClockMinutes !== actions.length || world.campaign.worldRevision !== actions.length
    || actions.some((entry, index) => entry.payload.fromMinutes !== index || entry.payload.toMinutes !== index + 1
      || entry.payload.fromRevision !== index || entry.payload.toRevision !== index + 1)) {
    throw new Error('Unproven character clock or revision');
  }
  // Only the strictly proven pickup changes weight; all other initial values remain exact.
  const pickup = readPickupHistory(world), transfer = readTransferHistory(world);
  if (world.player.background !== '' || Object.keys(world.player.skills).length !== 3
    || Object.entries(payload.skills).some(([key, value]) => world.player.skills[key] !== value)
    || Object.entries(payload.initialStats).some(([key, value]) => world.player.stats[key] !==
      (key === 'carryWeightKg' ? transfer?.carryWeightKg ?? pickup?.receipt?.afterCarryWeightKg ?? value : value))) {
    throw new Error('Character initial values disagree with world');
  }
  return payload;
}
export function validateCharacterRecord(world: CharacterWorld): void { creationRecord(world); }
/** Self-owned identity only; no world tables, event metadata, or perception data. */
export function readCharacterProfile(world: CharacterWorld): CharacterProfile | null {
  const record = creationRecord(world);
  return record ? parseCharacterInput({ profile: record.profile, skills: record.skills }) : null;
}
