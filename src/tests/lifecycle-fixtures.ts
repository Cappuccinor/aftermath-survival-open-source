import { createLifecyclePrototype, createLifecycleGame } from '../core/npc-lifecycle-prototype';
import { createHiddenItemPrototype, createHiddenItemGame } from '../core/npc-hidden-item-prototype';
import { doorCharacter, doorMetadata } from './door-fixtures';
export { action, clone, room, corridor, tin, water, cabinet, gun, sequence } from './hidden-item-fixtures';
export const lifeInit = 'evt-initial-npc-lifecycle', door = 'prototype-door-gap';
export const lifecycleEntries = [
  ['prototype', (status: 'alive' | 'dead' = 'alive', seed = 1) => createLifecyclePrototype(seed, status), () => createHiddenItemPrototype(1)],
  ['created', (status: 'alive' | 'dead' = 'alive', seed = 1) => createLifecycleGame(doorCharacter, { ...doorMetadata, seed }, status), () => createHiddenItemGame(doorCharacter, { ...doorMetadata, seed: 1 })],
] as const;
export const deadLife = { status: 'dead', source: 'pre-game-fixture-v1', cause: 'unspecified-pre-game-death', atGameMinutes: -1 };
