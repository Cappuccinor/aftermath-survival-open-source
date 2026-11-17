import { hiddenItem, hiddenItemId, hiddenItemType, hiddenScopeId, hiddenScopeSchema } from './npc-hidden-item-model';
import { doorScopeSchema } from './door-model';
import type { DoorWorld } from './door-model';
import { transferScopeSchema } from './transfer-model';
import type { PickupWorld } from './pickup-model';
import type { WorldEvent } from './events';
interface HiddenWorld extends PickupWorld { readonly npcs: DoorWorld['npcs']; readonly stateSchema?: string }
function ensure(condition: unknown): asserts condition { if (!condition) throw Error('Invalid hidden NPC item capability'); }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
const reserved = (event: WorldEvent) => event.eventId === hiddenScopeId || event.type === 'NpcHiddenItemInitialized'
  || (typeof event.payload.rule === 'string' && event.payload.rule.startsWith('npc-hidden-item-'));

/** Closed evidence vocabulary for this new capability only. Private initialization is never perception. */
function validatePlayerEvidence(world: HiddenWorld, room: string, corridor: string, door: string) {
  const allowed = new Map<string, { source: string; time: number }>();
  for (const event of world.eventJournal) {
    const p = event.payload, request: Readonly<Record<string, unknown>> = p.request && typeof p.request === 'object' && !Array.isArray(p.request)
      ? p.request as Readonly<Record<string, unknown>> : {};
    let fact: string | undefined;
    if (event.type === 'KnownRouteInitialized' && event.eventId === 'evt-initial-route') fact = 'known-prototype-route';
    if (event.type === 'DoorGapInitialized' && event.eventId === 'evt-initial-door-gap') fact = `known-door-${door}`;
    if (event.type === 'BuildingSceneInitialized' && event.eventId === 'evt-initial-building-scene') fact = 'known-building-scene';
    if (event.type === 'CabinetSceneInitialized' && event.eventId === 'evt-initial-cabinet') fact = 'cabinet-known';
    if (event.type === 'ObservationRecorded' && p.rule === 'observe-v1' && [room, corridor].includes(String(request.locationId))) fact = `sight-${request.locationId}-light`;
    if (event.type === 'InspectionRecorded' && p.rule === 'inspect-v1' && request.itemId === 'prototype-tin') fact = 'inspection-prototype-tin-appearance';
    if (event.type === 'PlayerMoved' && p.rule === 'move-v1' && request.actorId === world.player.playerId) fact = `movement-${world.player.playerId}-location`;
    if (event.type === 'SearchRecorded' && p.rule === 'search-v1' && request.locationId === room) fact = `search-${room}-result`;
    if (event.type === 'ItemDiscovered' && p.rule === 'search-discovery-v1' && p.itemId === 'prototype-tin') fact = 'seen-item-prototype-tin';
    if (event.type === 'DoorObservationRecorded' && (p.rule === 'door-observe-v1' || p.rule === 'door-observe-v2') && request.doorId === door) fact = `door-observation-${p.commandId}`;
    if (event.type === 'DoorReactionHeard' && p.rule === 'door-reaction-v1' && p.doorId === door) fact = `door-heard-${p.commandId}`;
    if (event.type === 'CabinetSearchRecorded' && p.rule === 'cabinet-search-v2' && request.cabinetId === 'prototype-cabinet') fact = 'cabinet-search-prototype-cabinet';
    if (event.type === 'CabinetContentDiscovered' && p.rule === 'cabinet-discovery-v1' && p.itemId === 'prototype-bottled-water') fact = 'cabinet-discovery-prototype-bottled-water';
    if (event.type === 'ItemTransferred' && p.rule === 'pick_up-v2' && ['prototype-tin', 'prototype-bottled-water'].includes(String(request.itemId))) fact = `transfer-${request.itemId}`;
    if (world.stateSchema === 'g2-world-v2' && event.type === 'PlayerContactHeard' && p.rule === 'contact-perception-v1'
      && typeof p.npcId === 'string') {
      const contactFact = `contact-heard-${p.npcId}`;
      if (!allowed.has(contactFact)) allowed.set(contactFact, { source: event.eventId, time: event.worldTimeMinutes });
    }
    if (fact) allowed.set(fact, { source: event.eventId, time: event.worldTimeMinutes });
  }
  for (const k of world.knowledge) {
    const proof = allowed.get(k.factId);
    ensure(proof && k.source === proof.source && k.observedAt === proof.time && k.knowerId === world.player.playerId
      && k.confidence === 1 && k.expiresAt === undefined && world.player.knownFactIds.includes(k.factId));
  }
  ensure(world.player.knownFactIds.every(id => allowed.has(id) && world.knowledge.some(k => k.factId === id)));
}

/** Leaf schema audit; existing validators prove their own domains, no world parser or recursive audits. */
export function readHiddenItemScope(world: HiddenWorld) {
  const scopes = world.eventJournal.filter(reserved);
  const items = Object.values(world.items).filter(item => item.position.kind === 'npc' || item.itemId.startsWith(hiddenItemId) || item.typeId === hiddenItemType);
  if (!scopes.length) { ensure(!items.length); return null; }
  ensure(scopes.length === 1 && items.length === 1);
  const event = scopes[0]!, scope = hiddenScopeSchema.parse(event.payload);
  const doorEvent = world.eventJournal.find(e => e.eventId === scope.doorSourceEventId), transferEvent = world.eventJournal.find(e => e.eventId === scope.transferSourceEventId);
  const door = doorScopeSchema.parse(doorEvent?.payload), transfer = transferScopeSchema.parse(transferEvent?.payload);
  ensure(event.type === 'NpcHiddenItemInitialized' && event.eventId === hiddenScopeId && event.actorId === world.player.playerId
    && event.visibility === 'private' && event.worldTimeMinutes === 0 && scope.playerId === world.player.playerId
    && canonical(event.targetIds) === canonical([scope.npcId, hiddenItemId]));
  ensure(doorEvent && transferEvent && doorEvent.type === 'DoorGapInitialized' && transferEvent.type === 'TransferScopeInitialized'
    && doorEvent.seq < transferEvent.seq && transferEvent.seq + 1 === event.seq && transfer.playerId === scope.playerId
    && door.npcId === scope.npcId && transfer.locationId === door.roomId && world.npcs.length === 1 && world.npcs[0]?.npcId === scope.npcId
    && world.eventJournal.every(e => e.type !== 'TimeAdvanced' || e.seq > event.seq));
  ensure(canonical(scope.initialItem) === canonical(hiddenItem(scope.npcId)) && canonical(items[0]) === canonical(scope.initialItem));
  ensure(world.eventJournal.every(e => e === event || !e.targetIds.includes(hiddenItemId)));
  validatePlayerEvidence(world, door.roomId, door.corridorId, door.doorId);
  return scope;
}
