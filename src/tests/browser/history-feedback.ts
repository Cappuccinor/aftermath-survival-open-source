// ISOLATED TEST COMPOSITION: actual persistence, IndexedDB and UI; no public debug hooks.
import { createPersistenceController } from '../../application/persistence';
import { createIndexedDbStorage } from '../../adapters/storage/indexed-db';
import { createLifecyclePrototype } from '../../core/npc-lifecycle-prototype';
import { mountObservationUI } from '../../ui/main';
import type { PortResult } from '../../application/ports';
let settle: ((rejected: boolean) => void) | undefined;
export function finish(rejected: boolean) { settle?.(rejected); }
export function install() {
  const c = createPersistenceController(createIndexedDbStorage(), { narrationTimeoutMs: 1000, narrator: {
    narrate: outcome => new Promise<PortResult<string>>((resolve, reject) => {
      settle = rejected => rejected ? reject(Error('isolated delayed rejection')) : resolve({ ok: true, value: outcome.summary });
    }),
  } });
  mountObservationUI(document.querySelector<HTMLElement>('#app')!, () => c.start(createLifecyclePrototype()).session, undefined, c.client);
}
