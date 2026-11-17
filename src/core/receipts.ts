import { contactReceiptSchema, contactEventId, contactTypes } from './contact-model';
import type { ContactReceipt } from './contact-model';
import { transferReceiptSchema, transferEventId, transferFactId, cabinetSearchV2Schema } from './transfer-model';
import type { TransferReceipt, CabinetSearchV2 } from './transfer-model';
import { readTransferHistory } from './transfer-history';
import { cabinetReceiptSchema, cabinetSearchEventId, cabinetSearchFact } from './cabinet-model';
import type { CabinetReceipt } from './cabinet-model';
import { canSearchCabinet } from './cabinet-search';
import { searchReceiptSchema, searchScope, canSearch, discoverySchema } from './search';
import type { SearchReceipt } from './search';
import { seenItemFactId } from './inspection';
import { movementReceiptSchema, canMove, knownRoute } from './movement';
import type { MovementReceipt } from './movement';
import { z } from 'zod';
import { clockSchema, freezeSnapshot, idSchema, integerSchema } from './schema';
import type { WorldState } from './world';
import { observationEventId, observationFactId, observationReceiptSchema, observationVisibility } from './observation';
import type { ObservationReceipt } from './observation';
import { canPerceiveInspectableItem, inspectionEventId, inspectionFactId, inspectionReceiptSchema } from './inspection';
import type { InspectionReceipt } from './inspection';
import { anyDoorReceiptSchema } from './npc-lifecycle-model';
import type { DeadDoorReceipt } from './npc-lifecycle-model';
import type { DoorReceipt } from './door-model';
import { canObserveDoor, doorResultEventId, doorResultFactId } from './door-observation';
import { pickupReceiptSchema, pickupEventId, pickupFactId } from './pickup-model';
import type { PickupReceipt } from './pickup-model';

export type ActionReceipt = ObservationReceipt | InspectionReceipt | MovementReceipt | SearchReceipt | DoorReceipt | DeadDoorReceipt | PickupReceipt | CabinetReceipt | TransferReceipt | CabinetSearchV2 | ContactReceipt;
const timeSchema = z.strictObject({
  rule: z.enum(['talk-v1', 'observe-v1', 'inspect-v1', 'move-v1', 'search-v1', 'door-observe-v1', 'door-observe-v2', 'pick_up-v1', 'cabinet-search-v1', 'cabinet-search-v2', 'pick_up-v2']), commandId: idSchema,
  fromMinutes: clockSchema, toMinutes: clockSchema,
  fromRevision: integerSchema, toRevision: integerSchema.min(1),
});
export function receiptEventId(receipt: ActionReceipt) {
  if (receipt.rule === 'talk-v1') return contactEventId(receipt.commandId);
  if (receipt.rule === 'pick_up-v2') return transferEventId(receipt.commandId);
  if (receipt.rule === 'cabinet-search-v1' || receipt.rule === 'cabinet-search-v2') return cabinetSearchEventId(receipt.commandId);
  if (receipt.rule === 'pick_up-v1') return pickupEventId(receipt.commandId);
  if ((receipt.rule === 'door-observe-v1' || receipt.rule === 'door-observe-v2')) return doorResultEventId(receipt.commandId);
  return receipt.rule === 'search-v1' ? `evt-${receipt.commandId}-search` : receipt.rule === 'move-v1' ? `evt-${receipt.commandId}-movement` : receipt.rule === 'observe-v1' ? observationEventId(receipt.commandId) : inspectionEventId(receipt.commandId);
}
export function receiptFactId(receipt: ActionReceipt) {
  if (receipt.rule === 'talk-v1') return `contact-action-${receipt.commandId}`;
  if (receipt.rule === 'pick_up-v2') return transferFactId(receipt.request.itemId);
  if (receipt.rule === 'cabinet-search-v1' || receipt.rule === 'cabinet-search-v2') return cabinetSearchFact;
  if (receipt.rule === 'pick_up-v1') return pickupFactId(receipt.request.itemId);
  if ((receipt.rule === 'door-observe-v1' || receipt.rule === 'door-observe-v2')) return doorResultFactId(receipt.commandId);
  return receipt.rule === 'search-v1' ? `search-${receipt.request.locationId}-result` : receipt.rule === 'move-v1' ? `movement-${receipt.request.actorId}-location` : receipt.rule === 'observe-v1' ? observationFactId(receipt.request.locationId) : inspectionFactId(receipt.request.itemId);
}

/** Strict version dispatch for supported transactions; not a general replay or authenticated save importer. */
export function readActionReceipts(world: WorldState): readonly ActionReceipt[] {
  const receipts: ActionReceipt[] = [];
  const scope=searchScope(world); let searched=false;
  const discovered=new Set<string>();
  let location = knownRoute(world)?.roomId;
  const commandIds = new Set<string>();
  const latestByFact = new Map<string, ActionReceipt>();
  for (let i = 0; i < world.eventJournal.length; i++) {
    const timeEvent = world.eventJournal[i]!;
    if (contactTypes.has(timeEvent.type)) throw new Error('Orphan contact receipt');
    if (['ItemTransferred', 'CabinetSearchRecorded', 'CabinetContentDiscovered', 'ItemPickedUp', 'DoorObservationRecorded', 'NPCAlertnessChanged', 'DoorReactionHeard', 'ItemDiscovered', 'SearchRecorded', 'ObservationRecorded', 'InspectionRecorded', 'PlayerMoved'].includes(timeEvent.type)) throw new Error('Orphan action receipt');
    if (timeEvent.type !== 'TimeAdvanced') continue;
    const time = timeSchema.parse(timeEvent.payload);
    if (time.rule === 'talk-v1' && world.stateSchema !== 'g2-world-v2') throw Error('Contact requires v2');
    const ensure = (condition: boolean) => { if (!condition) throw new Error(`Inconsistent ${time.rule} journal`); };
    const resultEvent = world.eventJournal[++i];
    const expectedType = time.rule === 'talk-v1' ? 'GreetingRecorded' : time.rule === 'pick_up-v2' ? 'ItemTransferred' : (time.rule === 'cabinet-search-v1' || time.rule === 'cabinet-search-v2') ? 'CabinetSearchRecorded' : time.rule === 'pick_up-v1' ? 'ItemPickedUp' : (time.rule === 'door-observe-v1' || time.rule === 'door-observe-v2') ? 'DoorObservationRecorded' : time.rule === 'search-v1' ? 'SearchRecorded' : time.rule === 'move-v1' ? 'PlayerMoved' : time.rule === 'observe-v1' ? 'ObservationRecorded' : 'InspectionRecorded';
    ensure(resultEvent?.type === expectedType);
    if (!resultEvent) throw new Error('Missing action receipt');
    const receipt: ActionReceipt = freezeSnapshot(time.rule === 'talk-v1' ? contactReceiptSchema.parse(resultEvent.payload) : time.rule === 'pick_up-v2' ? transferReceiptSchema.parse(resultEvent.payload) : time.rule === 'cabinet-search-v2' ? cabinetSearchV2Schema.parse(resultEvent.payload) : time.rule === 'cabinet-search-v1' ? cabinetReceiptSchema.parse(resultEvent.payload) : time.rule === 'pick_up-v1' ? pickupReceiptSchema.parse(resultEvent.payload) : (time.rule === 'door-observe-v1' || time.rule === 'door-observe-v2') ? anyDoorReceiptSchema.parse(resultEvent.payload) : time.rule === 'search-v1' ? searchReceiptSchema.parse(resultEvent.payload) : time.rule === 'move-v1' ? movementReceiptSchema.parse(resultEvent.payload) : time.rule === 'observe-v1'
      ? observationReceiptSchema.parse(resultEvent.payload) : inspectionReceiptSchema.parse(resultEvent.payload));
    ensure(!commandIds.has(receipt.commandId) && time.commandId === receipt.commandId);
    ensure(time.fromMinutes + 1 === time.toMinutes && time.fromRevision + 1 === time.toRevision);
    ensure(receipt.observedAt === time.toMinutes && receipt.committedRevision === time.toRevision);
    ensure(receipt.request.expectedWorldRevision === time.fromRevision && receipt.request.actorId === world.player.playerId);
    ensure(Object.hasOwn(world.locations, receipt.request.locationId));
    location ??= receipt.request.locationId;
    ensure(receipt.request.locationId === location);
    // Validate item ownership and perception at the historical event cursor.
    if (receipt.rule === 'talk-v1') {
      if (receipt.result === 'first_warning' || receipt.result === 'repeated_warning') i += 4;
    } else if (receipt.rule === 'cabinet-search-v1' || receipt.rule === 'cabinet-search-v2') {
      ensure(canSearchCabinet(world, receipt.request.cabinetId, location));
      // parseWorldState already audited the adjacent discovery and its first evidence.
      if (receipt.discoveredItemId) i++;
    } else if (receipt.rule === 'pick_up-v2') {
      ensure(!!readTransferHistory(world));
    } else if (receipt.rule === 'pick_up-v1') {
      ensure(canPerceiveInspectableItem(world, receipt.request.itemId, time.fromMinutes, location, timeEvent.seq));
    } else if ((receipt.rule === 'door-observe-v1' || receipt.rule === 'door-observe-v2')) {
      ensure(canObserveDoor(world, receipt.request.doorId, location));
      // world validation already audited the two samples and exact adjacent notice/sound events.
      if (receipt.noticed) i += 2;
    } else if (receipt.rule === 'observe-v1') {
      ensure(receipt.visibility === observationVisibility(world.locations[receipt.request.locationId]!.light));
    } else if (receipt.rule === 'inspect-v1') {
      ensure(canPerceiveInspectableItem(world, receipt.request.itemId, time.fromMinutes, location, timeEvent.seq));
    } else if (receipt.rule === 'search-v1') {
      ensure(!!scope && canSearch(world, receipt.request.locationId, location));
      if (!scope) throw new Error('Missing search scope');
      const known = discovered.has(scope.itemId)
        || canPerceiveInspectableItem(world, scope.itemId, time.fromMinutes, location, timeEvent.seq);
      ensure(receipt.discoveredItemId === (known ? null : scope.itemId));
      searched = true;
      if (receipt.discoveredItemId) {
        const event = world.eventJournal[++i];
        const payload = discoverySchema.parse(event?.payload);
        ensure(!!event
          && event.type === 'ItemDiscovered'
          && event.eventId === `evt-${receipt.commandId}-discovery`
          && event.actorId === receipt.request.actorId
          && event.visibility === 'private'
          && event.worldTimeMinutes === receipt.observedAt
          && event.targetIds.length === 1
          && event.targetIds[0] === scope.itemId
          && payload.commandId === receipt.commandId
          && payload.itemId === scope.itemId
          && payload.locationId === location
          && payload.observedAt === receipt.observedAt);
        const fact = world.knowledge.find(k => k.factId === seenItemFactId(scope.itemId));
        ensure(!!fact
          && fact.source === event!.eventId
          && fact.observedAt === receipt.observedAt
          && fact.confidence === 1
          && fact.expiresAt === undefined
          && world.player.knownFactIds.includes(fact.factId));
        discovered.add(scope.itemId);
      }
    } else {
      ensure(canMove(world, location, receipt.request.destinationId));
      location = receipt.request.destinationId;
    }
    ensure(timeEvent.eventId === `evt-${receipt.commandId}-time` && resultEvent.eventId === receiptEventId(receipt));
    const targetId = receipt.rule === 'talk-v1' ? receipt.request.locationId : (receipt.rule === 'cabinet-search-v1' || receipt.rule === 'cabinet-search-v2') ? receipt.request.cabinetId : (receipt.rule === 'door-observe-v1' || receipt.rule === 'door-observe-v2') ? receipt.request.doorId : receipt.rule === 'move-v1' ? receipt.request.destinationId : (receipt.rule === 'observe-v1' || receipt.rule === 'search-v1') ? receipt.request.locationId : receipt.request.itemId;
    for (const event of [timeEvent, resultEvent]) {
      ensure(event.worldTimeMinutes === receipt.observedAt && event.actorId === receipt.request.actorId);
      ensure(event.targetIds.length === 1 && event.targetIds[0] === targetId && event.visibility === 'private');
    }
    const prior = receipts.at(-1);
    if (prior) ensure(prior.committedRevision <= time.fromRevision && prior.observedAt <= time.fromMinutes);
    ensure(receipt.committedRevision <= world.campaign.worldRevision);
    commandIds.add(receipt.commandId); receipts.push(receipt); if (receipt.rule !== 'talk-v1') latestByFact.set(receiptFactId(receipt), receipt);
  }
  if(scope && world.locations[scope.locationId]!.searched!==searched) throw new Error('Inconsistent searched state');
  for(const fact of world.knowledge){
    const event=world.eventJournal.find(e=>e.eventId===fact.source);
    if(event?.type==='ItemDiscovered' && (!scope || !discovered.has(scope.itemId) || fact.factId!==seenItemFactId(scope.itemId))) throw new Error('Unproven discovery');
  }
  if (location !== undefined && location !== world.player.locationId) throw new Error('Historical location mismatch');
  for (const [factId, receipt] of latestByFact) {
    const evidence = world.knowledge.find(fact => fact.factId === factId);
    if (evidence?.source !== receiptEventId(receipt) || evidence.observedAt !== receipt.observedAt
      || evidence.confidence !== 1 || (receipt.rule !== 'observe-v1' && evidence.expiresAt !== undefined)
      || !world.player.knownFactIds.includes(factId)) {
      throw new Error(`Inconsistent ${receipt.rule} knowledge`);
    }
  }
  return Object.freeze(receipts);
}
