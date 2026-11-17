import { createHiddenItemPrototype, createHiddenItemGame } from '../core/npc-hidden-item-prototype';
import { createTransferPrototype, createTransferGame } from '../core/transfer-prototype';
import { doorCharacter, doorMetadata } from './door-fixtures';
export { action, clone, room, corridor, tin, water, cabinet } from './transfer-fixtures';
export const gun = 'prototype-hidden-handgun', gunType = 'hidden-handgun-fixture-v1', hiddenInit = 'evt-initial-npc-hidden-item';
export const hiddenEntries = [
  ['prototype', () => createHiddenItemPrototype(1), () => createTransferPrototype(1)],
  ['created', () => createHiddenItemGame(doorCharacter, { ...doorMetadata, seed: 1 }), () => createTransferGame(doorCharacter, { ...doorMetadata, seed: 1 })],
] as const;
export function sequence(first = 'prototype-bottled-water'): [string, string?][] {
  return [['observe', 'prototype-door-gap'], ['search', 'prototype-location'], ['inspect', 'prototype-tin'], ['search', 'prototype-cabinet'], ['pick_up', first],
    ['observe', 'prototype-door-gap'], ['pick_up', first === 'prototype-tin' ? 'prototype-bottled-water' : 'prototype-tin'],
    ['search', 'prototype-cabinet'], ['move', 'prototype-corridor'], ['observe'], ['move', 'prototype-location'],
    ['observe', 'prototype-door-gap'], ['search', 'prototype-location'], ['search', 'prototype-cabinet'],
    ['observe', 'prototype-door-gap'], ['move', 'prototype-corridor'], ['observe'], ['move', 'prototype-location'],
    ['observe', 'prototype-door-gap'], ['search', 'prototype-cabinet'], ['search', 'prototype-location'], ['observe'],
    ['observe', 'prototype-door-gap'], ['observe']];
}
