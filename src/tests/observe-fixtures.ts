import { createWorldState } from '../core/world';
import { initialInput, mutableJson } from './fixtures';

export function observe(commandId = 'cmd-1', expectedWorldRevision = 0) {
  return { commandId, actorId: 'player-1', source: 'text', verb: 'observe',
    targetIds: [], toolIds: [], arguments: {}, utterance: '观察四周', expectedWorldRevision };
}
export function scene(light = 0) {
  const state = mutableJson(createWorldState(initialInput));
  state.locations['location-1'].light = light;
  return state;
}
