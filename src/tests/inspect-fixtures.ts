import { observe, scene } from './observe-fixtures';

export function inspect(commandId = 'cmd-1', expectedWorldRevision = 0, itemId = 'tin-1') {
  return { ...observe(commandId, expectedWorldRevision), verb: 'inspect', targetIds: [itemId], utterance: '检查空罐' };
}
export function inspectionScene() {
  const world = scene(1);
  world.items['tin-1'] = { itemId: 'tin-1', typeId: 'empty-tin', position: { kind: 'location', id: 'location-1' },
    count: 1, weightKg: 0.05, durability: 73, condition: 'SECRET_condition', metadata: { name: 'SECRET_name', contents: 'SECRET_metadata' } };
  world.player.knownFactIds = ['seen-item-tin-1'];
  world.knowledge = [{ knowerId: 'player-1', factId: 'seen-item-tin-1', source: 'evt-init-tin-1-sighting', confidence: 1, observedAt: 0 }];
  world.eventJournal = [{ eventId: 'evt-init-tin-1-sighting', seq: 1, worldTimeMinutes: 0, type: 'ItemInitiallyPerceived',
    actorId: 'player-1', targetIds: ['tin-1'], visibility: 'private',
    payload: { rule: 'initial-sight-v1', itemId: 'tin-1', locationId: 'location-1', observedAt: 0 } }];
  return world;
}
