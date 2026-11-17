import { createContactCandidate } from './contact';
import { readTransferHistory } from './transfer-history';
import { createTransferCandidate } from './transfer';
import { canSearch, searchScope } from './search';
import { seenItemFactId } from './inspection';
import { canMove } from './movement';
import { parseCommand } from './commands';
import type { Command } from './commands';
import { parseWorldState } from './world';
import type { WorldState } from './world';
import { observationVisibility } from './observation';
import { canPerceiveInspectableItem } from './inspection';
import { readActionReceipts, receiptEventId, receiptFactId } from './receipts';
import type { ActionReceipt } from './receipts';
import { canObserveDoor, createDoorCandidate } from './door-observation';
import { canPickUp, createPickupCandidate } from './pickup';
import { itemPositionAt } from './pickup-history';
import { canSearchCabinet, createCabinetCandidate } from './cabinet-search';

type FailureCode = 'invalid_command' | 'invalid_actor' | 'invalid_target' | 'unsupported_parameters'
  | 'unsupported_action' | 'stale_revision' | 'actor_unavailable' | 'command_id_conflict' | 'settlement_failed';
export type CoreActionResult =
  | { readonly ok: false; readonly code: FailureCode }
  | { readonly ok: true; readonly state: WorldState; readonly receipt: ActionReceipt; readonly replayed: boolean };
const failed = (code: FailureCode): CoreActionResult => Object.freeze({ ok: false, code });

/** Trusted Core/Application capability. Never expose this object to UI or AI. */
export function createEngine(input: unknown) {
  let state = parseWorldState(input);
  readActionReceipts(state);

  function dispatch(inputCommand: unknown): CoreActionResult {
    let command: Command;
    try { command = parseCommand(inputCommand); }
    catch { return failed('invalid_command'); }
    if (command.verb !== 'talk' && command.verb !== 'observe' && command.verb !== 'inspect' && command.verb !== 'move' && command.verb !== 'search' && command.verb !== 'pick_up') return failed('unsupported_action');
    if (command.verb === 'talk' && state.stateSchema !== 'g2-world-v2') return failed('unsupported_action');
    if (command.actorId !== state.player.playerId) return failed('invalid_actor');
    if (command.verb === 'observe' ? command.targetIds.length > 1
       : command.targetIds.length !== 1) {
      return failed('invalid_target');
    }
    const door = command.verb === 'observe' && command.arguments.through === 'door_gap';
    const validParameters = command.verb === 'talk' ? command.arguments.topic === 'greeting' && Object.keys(command.arguments).length === 1 : door ? command.arguments.careful === true && Object.keys(command.arguments).length === 2
      : Object.keys(command.arguments).length === 0;
    if (command.toolIds.length !== 0 || !validParameters) return failed(command.verb === 'talk' && readActionReceipts(state).some(r => r.commandId === command.commandId) ? 'command_id_conflict' : 'unsupported_parameters');
    if (door && command.targetIds.length !== 1) return failed('invalid_target');
    const request = { actorId: command.actorId, locationId: state.player.locationId,
      expectedWorldRevision: command.expectedWorldRevision };
    const previous = readActionReceipts(state).find(receipt => receipt.commandId === command.commandId);
    if (previous) {
      if ((previous.rule === 'talk-v1' && previous.request.locationId !== command.targetIds[0])
        || previous.rule !== (door ? (previous.rule === 'door-observe-v2' ? 'door-observe-v2' : 'door-observe-v1') : command.verb === 'search' && (previous.rule === 'cabinet-search-v1' || previous.rule === 'cabinet-search-v2') ? previous.rule : command.verb === 'pick_up' && previous.rule === 'pick_up-v2' ? 'pick_up-v2' : `${command.verb}-v1`)
        || ((previous.rule === 'cabinet-search-v1' || previous.rule === 'cabinet-search-v2') && previous.request.cabinetId !== command.targetIds[0])
        || ((previous.rule === 'door-observe-v1' || previous.rule === 'door-observe-v2') && previous.request.doorId !== command.targetIds[0])
        || ((previous.rule === 'inspect-v1' || previous.rule === 'pick_up-v1' || previous.rule === 'pick_up-v2') && previous.request.itemId !== command.targetIds[0])
        || (previous.rule === 'observe-v1' && command.targetIds.length === 1 && command.targetIds[0] !== previous.request.locationId)
        || (previous.rule === 'search-v1' && command.targetIds[0] !== previous.request.locationId)
        || (previous.rule === 'move-v1' && command.targetIds[0] !== previous.request.destinationId)
        || previous.request.actorId !== request.actorId
        || previous.request.expectedWorldRevision !== request.expectedWorldRevision) return failed('command_id_conflict');
      return Object.freeze({ ok: true, state, receipt: previous, replayed: true });
    }
    if (command.verb === 'talk' && command.targetIds[0] !== state.player.locationId) return failed('invalid_target');
    if (door && !canObserveDoor(state, command.targetIds[0]!)) return failed('invalid_target');
    if (!door && command.verb === 'observe' && command.targetIds.length === 1 && command.targetIds[0] !== state.player.locationId) return failed('invalid_target');
    const cabinet = command.verb === 'search' && canSearchCabinet(state, command.targetIds[0]!);
    if (command.verb === 'search' && !cabinet && !canSearch(state, command.targetIds[0]!)) return failed('invalid_target');
    if (command.verb === 'move' && !canMove(state, state.player.locationId, command.targetIds[0]!)) return failed('invalid_target');
    if (command.expectedWorldRevision !== state.campaign.worldRevision) return failed('stale_revision');
    if (state.player.stats.hp === 0) return failed('actor_unavailable');
    if (command.verb === 'inspect' && !canPerceiveInspectableItem(state, command.targetIds[0]!)) return failed('invalid_target');
    if (command.verb === 'pick_up' && !canPickUp(state, command.targetIds[0]!)) return failed('invalid_target');

    // Build an owned candidate; the authoritative reference changes only after all checks pass.
    try {
      if (command.verb === 'talk') {
        const candidate = parseWorldState(createContactCandidate(state, command));
        const receipt = readActionReceipts(candidate).at(-1)!;
        state = candidate;
        return Object.freeze({ ok: true, state, receipt, replayed: false });
      }
      if (cabinet || door || command.verb === 'pick_up') {
        const candidate = parseWorldState(cabinet ? createCabinetCandidate(state, command) : door ? createDoorCandidate(state, command) : readTransferHistory(state) ? createTransferCandidate(state, command) : createPickupCandidate(state, command));
        const receipt = readActionReceipts(candidate).at(-1)!;
        state = candidate;
        return Object.freeze({ ok: true, state, receipt, replayed: false });
      }
      const observedAt = state.campaign.gameClockMinutes + 1;
      const committedRevision = state.campaign.worldRevision + 1;
      const shared = { commandId: command.commandId, elapsedMinutes: 1 as const, committedRevision, observedAt };
      const receipt: ActionReceipt = command.verb === 'observe'
        ? { ...shared, rule: 'observe-v1', request, visibility: observationVisibility(state.locations[state.player.locationId]!.light) }
        : command.verb === 'search' ? { ...shared, rule: 'search-v1', request, discoveredItemId: itemPositionAt(state, searchScope(state)!.itemId)?.kind !== 'location' || canPerceiveInspectableItem(state, searchScope(state)!.itemId) ? null : searchScope(state)!.itemId }
        : command.verb === 'move' ? { ...shared, rule: 'move-v1', request: { ...request, destinationId: command.targetIds[0]! } }
        : { ...shared, rule: 'inspect-v1', request: { ...request, itemId: command.targetIds[0]! }, appearance: 'open-metal-tin-v1' };
      const targetId = receipt.rule === 'move-v1' ? receipt.request.destinationId : (receipt.rule === 'observe-v1' || receipt.rule === 'search-v1') ? request.locationId : receipt.request.itemId;
      const eventFields = { worldTimeMinutes: observedAt, actorId: command.actorId,
        targetIds: [targetId], visibility: 'private' as const };
      const timeEvent = { ...eventFields, eventId: `evt-${command.commandId}-time`,
        seq: state.eventJournal.length + 1, type: 'TimeAdvanced', payload: {
          rule: receipt.rule, commandId: command.commandId,
          fromMinutes: state.campaign.gameClockMinutes, toMinutes: observedAt,
          fromRevision: state.campaign.worldRevision, toRevision: committedRevision,
        } };
      const resultEvent = { ...eventFields, eventId: receiptEventId(receipt),
        seq: state.eventJournal.length + 2, type: receipt.rule === 'search-v1' ? 'SearchRecorded' : receipt.rule === 'move-v1' ? 'PlayerMoved' : receipt.rule === 'observe-v1' ? 'ObservationRecorded' : 'InspectionRecorded', payload: receipt };
      const factId = receiptFactId(receipt);
      const knowledge = { knowerId: command.actorId, factId, source: resultEvent.eventId,
        confidence: 1, observedAt };
      const discovery = receipt.rule === 'search-v1' && receipt.discoveredItemId ? {
        ...eventFields,
        eventId: `evt-${command.commandId}-discovery`,
        seq: state.eventJournal.length + 3,
        type: 'ItemDiscovered',
        targetIds: [receipt.discoveredItemId],
        payload: {
          rule: 'search-discovery-v1',
          commandId: command.commandId,
          itemId: receipt.discoveredItemId,
          locationId: request.locationId,
          observedAt,
        },
      } : undefined;
      const discoveredFact = discovery ? {
        knowerId: command.actorId,
        factId: seenItemFactId(discovery.payload.itemId),
        source: discovery.eventId,
        confidence: 1,
        observedAt,
      } : undefined;
      const candidate = parseWorldState({ ...state,
        locations: receipt.rule === 'search-v1' ? {
          ...state.locations,
          [request.locationId]: { ...state.locations[request.locationId], searched: true },
        } : state.locations,
        campaign: { ...state.campaign, gameClockMinutes: observedAt, worldRevision: committedRevision },
        player: { ...state.player, locationId: receipt.rule === 'move-v1' ? receipt.request.destinationId : state.player.locationId, knownFactIds: state.player.knownFactIds.includes(factId)
          ? state.player.knownFactIds : [...state.player.knownFactIds, factId, ...(discoveredFact ? [discoveredFact.factId] : [])] },
        knowledge: [...state.knowledge.filter(fact => fact.factId !== factId), knowledge, ...(discoveredFact ? [discoveredFact] : [])],
        eventJournal: [...state.eventJournal, timeEvent, resultEvent, ...(discovery ? [discovery] : [])],
      });
      const checkedReceipt = readActionReceipts(candidate).at(-1)!;
      state = candidate;
      return Object.freeze({ ok: true, state, receipt: checkedReceipt, replayed: false });
    } catch {
      return failed('settlement_failed');
    }
  }
  return Object.freeze({ dispatch, snapshot: () => state });
}
