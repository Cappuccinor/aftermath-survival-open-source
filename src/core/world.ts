import { contactRelationSchema, contactMemorySchema, npcContactTypes } from './contact-model';
import { validateContactHistory } from './contact-history';
import { lifecycleWitnessSchema } from './npc-lifecycle-model';
import { readLifecycle } from './npc-lifecycle-history';
import { z } from 'zod';
import { createRng, rngStateSchema } from './rng';
import { eventJournalSchema } from './events';
import { idSchema, integerSchema, seedSchema, clockSchema, jsonRecordSchema, freezeSnapshot } from './schema';
import type { DeepReadonly } from './schema';
import { validateCharacterRecord } from './character';
import { doorWitnessSchema } from './door-model';
import { readDoorScope } from './door-observation';
import { validateDoorHistory } from './door-history';
import { itemSchema } from './item-model';
import { readPickupHistory } from './pickup-history';
import { readBuildingScene } from './building-scene';
import { validateCabinetHistory } from './cabinet-history';
import { readHiddenItemScope } from './npc-hidden-item-history';

const scale = z.number().min(0).max(100);
const statsSchema = z.strictObject({
  hp: scale, stamina: scale, mental: scale, hunger: scale, thirst: scale,
  fatigue: scale, infection: scale, pain: scale,
  bodyTempC: z.number(), carryWeightKg: z.number().nonnegative(),
});
const locationSchema = z.strictObject({
  locationId: idSchema, name: z.string(), adjacentLocationIds: z.array(idSchema),
  light: z.number().min(0).max(1), searched: z.boolean(),
});
const knowledgeSchema = z.strictObject({
  knowerId: idSchema, factId: idSchema, source: z.string().min(1),
  confidence: z.number().min(0).max(1), observedAt: clockSchema, expiresAt: clockSchema.optional(),
});
// Reject later-stage data instead of silently accepting or dropping unsupported facts.
const deferredCollection = z.array(z.never());
const legacyWorldSchema = z.strictObject({
  stateSchema: z.literal('g0-world-v1'),
  campaign: z.strictObject({
    saveId: idSchema, schemaVersion: z.null(), difficulty: z.literal('test_fixture'),
    seed: seedSchema, createdAt: z.iso.datetime({ precision: 3 }),
    gameClockMinutes: clockSchema, worldRevision: integerSchema,
    offlineProgressionEnabled: z.literal(false),
  }),
  player: z.strictObject({
    playerId: idSchema, background: z.string(), locationId: idSchema,
    stats: statsSchema, skills: z.record(idSchema, scale), knownFactIds: z.array(idSchema),
  }),
  locations: z.record(idSchema, locationSchema),
  items: z.record(idSchema, itemSchema),
  knowledge: z.array(knowledgeSchema),
  npcs: z.array(z.discriminatedUnion('kind', [doorWitnessSchema, lifecycleWitnessSchema])).max(1), relationships: deferredCollection, factions: deferredCollection,
  bases: deferredCollection, vehicles: deferredCollection, jobs: deferredCollection,
  eventJournal: eventJournalSchema,
  rngState: rngStateSchema,
});
const worldSchema = z.discriminatedUnion('stateSchema', [legacyWorldSchema, legacyWorldSchema.extend({
  stateSchema: z.literal('g2-world-v2'), relationships: z.array(contactRelationSchema).max(1),
  npcMemories: z.array(contactMemorySchema).max(2),
})]).superRefine((world, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
  const exists = (table: object, id: string) => Object.hasOwn(table, id);
  const ids = new Set([world.player.playerId]);
  if (!exists(world.locations, world.player.locationId)) fail('Player location does not exist');
  for (const [key, location] of Object.entries(world.locations)) {
    if (key !== location.locationId || ids.has(key)) fail('Location ID mismatch or collision');
    ids.add(key);
    if (new Set(location.adjacentLocationIds).size !== location.adjacentLocationIds.length) fail('Duplicate adjacency');
    for (const adjacent of location.adjacentLocationIds) {
      if (!exists(world.locations, adjacent)) fail('Adjacent location does not exist');
    }
  }
  for (const [key, item] of Object.entries(world.items)) {
    if (key !== item.itemId || ids.has(key)) fail('Item ID mismatch or collision');
    ids.add(key);
    const pos = item.position;
    if (pos.kind === 'player' && pos.id !== world.player.playerId) fail('Item owner does not exist');
    if (pos.kind === 'location' && !exists(world.locations, pos.id)) fail('Item location does not exist');
    if (pos.kind === 'container' && !exists(world.items, pos.id)) fail('Container does not exist');
    if (pos.kind === 'npc' && !world.npcs.some(npc => npc.npcId === pos.id)) fail('NPC item owner does not exist');
    const visited = new Set([key]);
    let current = item;
    while (current.position.kind === 'container') {
      const parentId = current.position.id;
      if (visited.has(parentId)) { fail('Container cycle'); break; }
      visited.add(parentId);
      const parent = world.items[parentId];
      if (!parent) break;
      current = parent;
    }
  }
  try {
    const scope = readDoorScope(world);
    if (scope) { ids.add(scope.doorId); ids.add(scope.npcId); }
    readLifecycle(world);
    validateDoorHistory(world);
  } catch { fail('Invalid door scene or history'); }
  const facts = new Set<string>();
  for (const knowledge of world.knowledge) {
    if (knowledge.knowerId !== world.player.playerId) fail('Knowledge owner does not exist');
    if (facts.has(knowledge.factId)) fail('Duplicate knowledge');
    facts.add(knowledge.factId);
    if (knowledge.observedAt > world.campaign.gameClockMinutes) fail('Observation from the future');
    if (knowledge.expiresAt !== undefined && knowledge.expiresAt < knowledge.observedAt) fail('Knowledge expires before observation');
  }
  if (new Set(world.player.knownFactIds).size !== world.player.knownFactIds.length) fail('Duplicate known fact');
  for (const factId of world.player.knownFactIds) if (!facts.has(factId)) fail('Known fact lacks evidence');
  for (const event of world.eventJournal) {
    if (event.worldTimeMinutes > world.campaign.gameClockMinutes) fail('Event from the future');
    if (event.actorId !== null && event.actorId !== world.player.playerId
      && !(world.stateSchema === 'g2-world-v2' && npcContactTypes.has(event.type) && world.npcs.some(n => n.npcId === event.actorId))) fail('Event actor does not exist');
    for (const id of event.targetIds) if (!ids.has(id)) fail('Event target does not exist');
  }
  try { validateContactHistory(world); }
  catch { fail('Invalid contact history'); }
  try { validateCharacterRecord(world); }
  catch { fail('Invalid character creation record'); }
  try { readPickupHistory(world); }
  catch { fail('Invalid pickup history'); }
  try { readBuildingScene(world); }
  catch { fail('Invalid building scene'); }
  try { validateCabinetHistory(world); }
  catch { fail('Invalid cabinet scene or history'); }
  try { readHiddenItemScope(world); }
  catch { fail('Invalid hidden NPC item capability'); }
});

export type WorldState = DeepReadonly<z.infer<typeof worldSchema>>;

/** Internal validation only; not a save importer and never applies event payloads. */
export function parseWorldState(input: unknown): WorldState {
  return freezeSnapshot(worldSchema.parse(input));
}

const initialInputSchema = z.strictObject({
  seed: seedSchema, saveId: idSchema, playerId: idSchema, locationId: idSchema,
  createdAt: z.iso.datetime({ precision: 3 }),
});

/** Pure fixture initialization; no game has been started, committed or saved. */
export function createWorldState(input: unknown): WorldState {
  const config = initialInputSchema.parse(input);
  return parseWorldState({
    stateSchema: 'g0-world-v1',
    campaign: {
      saveId: config.saveId, schemaVersion: null, difficulty: 'test_fixture', seed: config.seed,
      createdAt: config.createdAt, gameClockMinutes: 0, worldRevision: 0, offlineProgressionEnabled: false,
    },
    player: {
      playerId: config.playerId, background: '', locationId: config.locationId,
      stats: { hp: 100, stamina: 100, mental: 100, hunger: 0, thirst: 0,
        fatigue: 0, infection: 0, pain: 0, bodyTempC: 37, carryWeightKg: 0 },
      skills: {}, knownFactIds: [],
    },
    locations: { [config.locationId]: { locationId: config.locationId, name: 'G0 测试地点',
      adjacentLocationIds: [], light: 0, searched: false } },
    items: {}, knowledge: [], npcs: [], relationships: [], factions: [],
    bases: [], vehicles: [], jobs: [], eventJournal: [], rngState: createRng(config.seed).snapshot(),
  });
}

export function getWorldTime(minutes: number) {
  const total = clockSchema.parse(minutes) + 480;
  const elapsedDays = Math.floor(total / 1440);
  return Object.freeze({ worldDay: elapsedDays + 1, apocalypseDay: elapsedDays + 30,
    hour: Math.floor((total % 1440) / 60), minute: total % 60 });
}
