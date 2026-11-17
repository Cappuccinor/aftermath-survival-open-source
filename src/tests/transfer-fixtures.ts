import { createTransferPrototype, createTransferGame } from '../core/transfer-prototype';
import { createEngine } from '../core/engine';
import { doorCharacter, doorMetadata } from './door-fixtures';
import { action, room } from './pickup-fixtures';
export { action, clone, room, corridor, tin } from './pickup-fixtures';
export { cabinet, water } from './cabinet-fixtures';
export const transferEntries = [ ['prototype', () => createTransferPrototype(2976)], ['created', () => createTransferGame(doorCharacter, doorMetadata)] ] as const;
export function bothDiscovered(factory = transferEntries[0][1]) {
  const e = createEngine(factory()), actor = e.snapshot().player.playerId;
  if (!e.dispatch(action('search', 0, room, actor)).ok || !e.dispatch(action('search', 1, 'prototype-cabinet', actor)).ok) throw Error('discover fixture failed');
  return e;
}
