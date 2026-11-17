import { createSearchPrototype } from './prototype';
import { createNewGame } from './new-game';
import { parseWorldState } from './world';
import type { WorldState } from './world';
import { createRng } from './rng';
import { knownRoute } from './movement';
import { doorKnownFactId, doorScopeEventId } from './door-observation';

/** Trusted, opt-in composition. Existing factories retain their original worlds. */
export function addDoorGap(input: unknown): WorldState {
  const world = parseWorldState(input), route = knownRoute(world);
  if (!route || world.campaign.worldRevision !== 0 || world.campaign.gameClockMinutes !== 0
    || world.npcs.length || world.eventJournal.some(e => e.type === 'TimeAdvanced' || e.eventId === doorScopeEventId)) {
    throw new Error('Door scene requires an untouched known room');
  }
  const doorId = 'prototype-door-gap', npcId = 'prototype-witness', factId = doorKnownFactId(doorId);
  return parseWorldState({ ...world,
    npcs: [{ kind: 'g1-door-witness-v1', npcId, locationId: route.corridorId, appearance: 'worn-shoes-v1', alertness: 30, firstNoticed: null }],
    player: { ...world.player, knownFactIds: [...world.player.knownFactIds, factId] },
    knowledge: [...world.knowledge, { knowerId: world.player.playerId, factId, source: doorScopeEventId, confidence: 1, observedAt: 0 }],
    eventJournal: [...world.eventJournal, { eventId: doorScopeEventId, seq: world.eventJournal.length + 1, type: 'DoorGapInitialized',
      worldTimeMinutes: 0, actorId: world.player.playerId, targetIds: [doorId, route.roomId, route.corridorId, npcId], visibility: 'private',
      payload: { rule: 'door-gap-scope-v1', doorId, roomId: route.roomId, corridorId: route.corridorId, npcId,
        gapOpen: true, initialAlertness: 30, initialRng: world.rngState, perception: world.player.skills.perception ?? 0,
        stealth: world.player.skills.stealth ?? 0, corridorLight: world.locations[route.corridorId]!.light } }],
  });
}
export function createDoorPrototype(seed = 1): WorldState {
  const world = createSearchPrototype();
  return addDoorGap({ ...world, campaign: { ...world.campaign, seed }, rngState: createRng(seed).snapshot() });
}
export function createDoorGame(input: unknown, metadata: unknown): WorldState {
  return addDoorGap(createNewGame(input, metadata));
}
