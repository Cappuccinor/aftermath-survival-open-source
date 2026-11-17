import { z } from 'zod';
import { idSchema, seedSchema } from './schema';
import { createWorldState, parseWorldState } from './world';
import { createSearchPrototype } from './prototype';
import { initialCharacterStats, parseCharacterInput } from './character';

const metadataSchema = z.strictObject({ seed: seedSchema, saveId: idSchema, playerId: idSchema,
  createdAt: z.iso.datetime({ precision: 3 }) });

/** Trusted composition-root metadata; the form cannot select a world or its random stream. */
export function createNewGame(input: unknown, metadata: unknown) {
  const character = parseCharacterInput(input);
  const config = metadataSchema.parse(metadata);
  const scene = createSearchPrototype();
  const base = createWorldState({ ...config, locationId: scene.player.locationId });
  return parseWorldState({ ...scene, campaign: base.campaign, rngState: base.rngState,
    player: { ...scene.player, playerId: config.playerId, skills: character.skills },
    knowledge: scene.knowledge.map(fact => ({ ...fact, knowerId: config.playerId })),
    eventJournal: [{ eventId: 'evt-character-created', seq: 1, type: 'CharacterCreated', worldTimeMinutes: 0,
      actorId: config.playerId, targetIds: [config.playerId], visibility: 'private',
      payload: { rule: 'character-created-v1', initialRule: 'character-start-v1', profile: character.profile,
        skills: character.skills, initialStats: initialCharacterStats, startLocationId: scene.player.locationId } },
    ...scene.eventJournal.map((event, index) => ({ ...event, seq: index + 2, actorId: config.playerId }))],
  });
}
