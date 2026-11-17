import type { WorldState } from './world';
import type { Command } from './commands';
import { readTransferHistory } from './transfer-history';
import { cabinetDiscoveryFact, waterId } from './cabinet-model';
import { transferEventId, transferFactId } from './transfer-model';
import type { TransferReceipt } from './transfer-model';
export function canTransfer(world: WorldState, itemId: string): boolean {
  const history = readTransferHistory(world); if (!history || world.player.stats.hp === 0 || world.player.locationId !== history.scope.locationId
    || world.locations[history.scope.locationId]!.light < .5) return false;
  if (![history.scope.initialTin.itemId, waterId].includes(itemId) || history.records.some(r => r.receipt.request.itemId === itemId)) return false;
  const factId = itemId === waterId ? cabinetDiscoveryFact : `seen-item-${itemId}`;
  return world.player.knownFactIds.includes(factId) && world.knowledge.some(k => k.factId === factId);
}
export function createTransferCandidate(world: WorldState, command: Command) {
  const itemId = command.targetIds[0]!, item = world.items[itemId]!, observedAt = world.campaign.gameClockMinutes + 1, committedRevision = world.campaign.worldRevision + 1;
  if (itemId !== waterId && itemId !== 'prototype-tin') throw Error('Unsupported transfer item');
  const factId = itemId === waterId ? cabinetDiscoveryFact : `seen-item-${itemId}`;
  const receipt: TransferReceipt = { rule: 'pick_up-v2', commandId: command.commandId, request: { actorId: command.actorId, locationId: world.player.locationId, itemId, expectedWorldRevision: command.expectedWorldRevision },
    elapsedMinutes: 1, observedAt, committedRevision, from: item.position, to: { kind: 'player', id: command.actorId }, count: 1, weightKg: itemId === waterId ? .5 : .05,
    beforeCarryWeightKg: world.player.stats.carryWeightKg, afterCarryWeightKg: (Math.round(world.player.stats.carryWeightKg * 1000) + (itemId === waterId ? 500 : 50)) / 1000,
    perceptionSourceEventId: world.knowledge.find(k => k.factId === factId)!.source };
  const common = { actorId: command.actorId, targetIds: [itemId], visibility: 'private' as const, worldTimeMinutes: observedAt };
  const time = { ...common, eventId: `evt-${command.commandId}-time`, seq: world.eventJournal.length + 1, type: 'TimeAdvanced', payload: { rule: receipt.rule, commandId: command.commandId,
    fromMinutes: world.campaign.gameClockMinutes, toMinutes: observedAt, fromRevision: world.campaign.worldRevision, toRevision: committedRevision } };
  const event = { ...common, eventId: transferEventId(command.commandId), seq: time.seq + 1, type: 'ItemTransferred', payload: receipt };
  const fact = { factId: transferFactId(itemId), knowerId: command.actorId, source: event.eventId, confidence: 1, observedAt };
  return { ...world, campaign: { ...world.campaign, gameClockMinutes: observedAt, worldRevision: committedRevision },
    items: { ...world.items, [itemId]: { ...item, position: receipt.to } }, player: { ...world.player, stats: { ...world.player.stats, carryWeightKg: receipt.afterCarryWeightKg }, knownFactIds: [...world.player.knownFactIds, fact.factId] },
    knowledge: [...world.knowledge, fact], eventJournal: [...world.eventJournal, time, event] };
}
