import { createWorldState, parseWorldState } from './world';
import { initialSightingId, seenItemFactId } from './inspection';

export function createInspectionPrototype() {
  const world = createWorldState({ seed: 1, saveId: 'prototype-world', playerId: 'prototype-player',
    locationId: 'prototype-location', createdAt: '2026-10-23T00:00:00.000Z' });
  const itemId = 'prototype-tin'; const { playerId, locationId } = world.player;
  const factId = seenItemFactId(itemId); const eventId = initialSightingId(itemId);
  // Trusted initial scene evidence, not a discovery performed by observe-v1 or a player action.
  return parseWorldState({ ...world,
    locations: { [locationId]: { ...world.locations[locationId], light: 1 } },
    items: { [itemId]: { itemId, typeId: 'empty-tin', position: { kind: 'location', id: locationId },
      count: 1, weightKg: 0.05, durability: 100, condition: '', metadata: {} } },
    player: { ...world.player, knownFactIds: [factId] },
    knowledge: [{ knowerId: playerId, factId, source: eventId, confidence: 1, observedAt: 0 }],
    eventJournal: [{ eventId, seq: 1, type: 'ItemInitiallyPerceived', worldTimeMinutes: 0, actorId: playerId,
      targetIds: [itemId], visibility: 'private', payload: { rule: 'initial-sight-v1', itemId, locationId, observedAt: 0 } }],
  });
}

export function createMovementPrototype() {
  const world = createInspectionPrototype();
  const roomId = world.player.locationId, corridorId = 'prototype-corridor';
  return parseWorldState({ ...world,
    locations: { ...world.locations,
      [roomId]: { ...world.locations[roomId], adjacentLocationIds: [corridorId] },
      [corridorId]: { locationId: corridorId, name: '走廊', adjacentLocationIds: [roomId], light: 0.2, searched: false } },
    player: { ...world.player, knownFactIds: [...world.player.knownFactIds, 'known-prototype-route'] },
    knowledge: [...world.knowledge, { knowerId: world.player.playerId, factId: 'known-prototype-route', source: 'evt-initial-route', confidence: 1, observedAt: 0 }],
    eventJournal: [...world.eventJournal, { eventId: 'evt-initial-route', seq: world.eventJournal.length + 1, type: 'KnownRouteInitialized', worldTimeMinutes: 0,
      actorId: world.player.playerId, targetIds: [roomId, corridorId], visibility: 'private', payload: { rule: 'known-route-v1', roomId, corridorId } }],
  });
}

/** Search scene: the tin exists before discovery, without initial perception. */
export function createSearchPrototype() {
 const world=createMovementPrototype();
 const itemId='prototype-tin',locationId=world.player.locationId;
 return parseWorldState({...world,
  player:{...world.player,knownFactIds:world.player.knownFactIds.filter(id=>id!==seenItemFactId(itemId))},
  knowledge:world.knowledge.filter(k=>k.factId!==seenItemFactId(itemId)),
  eventJournal:[...world.eventJournal.filter(e=>e.eventId!==initialSightingId(itemId)),
   {eventId:'evt-initial-search',type:'SearchScopeInitialized',worldTimeMinutes:0,actorId:world.player.playerId,targetIds:[locationId],visibility:'private',payload:{rule:'search-scope-v1',locationId,itemId}}].map((e,i)=>({...e,seq:i+1})),
 });
}
