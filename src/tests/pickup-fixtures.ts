import { createPickupPrototype } from '../core/pickup-prototype';
import { createEngine } from '../core/engine';
export const tin = 'prototype-tin', room = 'prototype-location', corridor = 'prototype-corridor';
export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export const pickupCommand = (revision = 1, id = `pickup-${revision}`, actorId = 'prototype-player') => ({
  commandId: id, actorId, verb: 'pick_up', targetIds: [tin], toolIds: [], arguments: {},
  source: 'button', utterance: '拾取空罐', expectedWorldRevision: revision,
});
export const action = (verb: string, revision: number, target?: string, actorId = 'prototype-player') => ({
  ...pickupCommand(revision, `mixed-${revision}`, actorId), verb, targetIds: target ? [target] : [],
  arguments: target === 'prototype-door-gap' ? { through: 'door_gap', careful: true } : {},
});
export function discovered() {
  const engine = createEngine(createPickupPrototype());
  if (!engine.dispatch(action('search', 0, room)).ok) throw Error('search fixture failed');
  return engine;
}
