import { contactTypes } from './contact-model';
import { lifecycleId, lifecycleScopeSchema } from './npc-lifecycle-model';
import { doorScopeSchema } from './door-model';
import type { DoorWorld } from './door-model';
import type { WorldEvent } from './events';

const reserved = (e: WorldEvent) => e.eventId === lifecycleId || e.type === 'NpcLifecycleInitialized'
  || (typeof e.payload.rule === 'string' && e.payload.rule.startsWith('npc-lifecycle-'));
function ensure(value: unknown): asserts value { if (!value) throw Error('Invalid static NPC lifecycle'); }
const sameLife = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Leaf lifecycle audit: domain validators still prove all observation/transfer/knowledge history. */
export function readLifecycle(world: DoorWorld) {
  const records = world.eventJournal.filter(reserved);
  const npc = world.npcs[0];
  if (!records.length) { ensure(world.npcs.every(n => n.kind === 'g1-door-witness-v1')); return null; }
  ensure(records.length === 1 && world.npcs.length === 1 && npc?.kind === 'g1-static-witness-v2');
  const event = records[0]!, scope = lifecycleScopeSchema.parse(event.payload), initial = scope.initialNpc;
  const hidden = world.eventJournal.find(e => e.eventId === scope.hiddenSourceEventId);
  const doorEvent = world.eventJournal.find(e => e.eventId === 'evt-initial-door-gap');
  const door = doorScopeSchema.parse(doorEvent?.payload);
  ensure(event.eventId === lifecycleId && event.type === 'NpcLifecycleInitialized' && event.actorId === world.player.playerId
    && event.visibility === 'private' && event.worldTimeMinutes === 0 && scope.playerId === world.player.playerId
    && event.targetIds.length === 1 && event.targetIds[0] === npc.npcId);
  ensure(hidden?.type === 'NpcHiddenItemInitialized' && hidden.payload.rule === 'npc-hidden-item-scope-v1'
    && hidden.seq + 1 === event.seq && hidden.payload.npcId === npc.npcId
    && world.eventJournal.every(e => e.type !== 'TimeAdvanced' || e.seq > event.seq));
  ensure(initial.npcId === npc.npcId && initial.npcId === door.npcId && initial.locationId === door.corridorId
    && npc.locationId === initial.locationId && npc.appearance === initial.appearance
    && initial.alertness === door.initialAlertness && initial.firstNoticed === null && sameLife(npc.life, initial.life));
  if (npc.life.status === 'dead') {
    ensure(npc.alertness === initial.alertness && npc.firstNoticed === null);
    ensure(!world.eventJournal.some(e => ['NPCAlertnessChanged', 'DoorReactionHeard'].includes(e.type)));
  }
  // This closed capability has no NPC actions or arbitrary extra lifecycle events.
  const allowed = new Set(['CharacterCreated','SearchScopeInitialized','KnownRouteInitialized','DoorGapInitialized',
    'PickupScopeInitialized','BuildingSceneInitialized','CabinetSceneInitialized','TransferScopeInitialized','NpcHiddenItemInitialized',
    'NpcLifecycleInitialized','TimeAdvanced','ObservationRecorded','InspectionRecorded','PlayerMoved','SearchRecorded',
    'ItemDiscovered','DoorObservationRecorded','NPCAlertnessChanged','DoorReactionHeard','CabinetSearchRecorded','CabinetContentDiscovered','ItemTransferred']);
  for (const e of world.eventJournal) {
    // v2 contact history separately proves this exact group and its NPC authority.
    if (world.stateSchema === 'g2-world-v2' && contactTypes.has(e.type)) continue;
    ensure(allowed.has(e.type) && e.actorId === world.player.playerId);
    if (e.targetIds.includes(npc.npcId)) ensure(['DoorGapInitialized','NpcHiddenItemInitialized','NpcLifecycleInitialized','NPCAlertnessChanged'].includes(e.type));
  }
  return scope;
}
