import { createCabinetGame, createCabinetPrototype } from '../core/cabinet-prototype';
import { doorCharacter, doorMetadata } from './door-fixtures';
export { action, clone, room, corridor, tin } from './pickup-fixtures';
export const cabinet = 'prototype-cabinet', water = 'prototype-bottled-water';
export const entries = [
  ['prototype', () => createCabinetPrototype(2976)],
  ['created', () => createCabinetGame(doorCharacter, doorMetadata)],
] as const;
