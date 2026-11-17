import { createPersistenceController } from './application/persistence';
import { createIndexedDbStorage } from './adapters/storage/indexed-db';
import { createBrowserDownload } from './adapters/storage/browser-download';
import { parseWorldState } from './core/world';
import { createContactGame, createContactPrototype } from './core/contact-prototype';
import { mountObservationUI } from './ui/main';
import { createCharacterCreation } from './application/character-creation';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Missing application root');
const persistence = createPersistenceController(createIndexedDbStorage(), { download: createBrowserDownload() });
const prototype = () => {
  const world = createContactPrototype();
  return persistence.start(parseWorldState({ ...world, campaign: { ...world.campaign, saveId: `world-${crypto.randomUUID()}` } }));
};
const creation = createCharacterCreation({ prototype,
  create(input) {
    const seed = crypto.getRandomValues(new Uint32Array(1))[0] || 1;
    const world = createContactGame(input, { seed, saveId: `world-${crypto.randomUUID()}`,
      playerId: `player-${crypto.randomUUID()}`, createdAt: new Date().toISOString() });
    return persistence.start(world);
  },
}, 'building-room');
mountObservationUI(root, () => prototype().session, creation, persistence.client);
