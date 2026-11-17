import { readTransferHistory } from './transfer-history';
import type { CabinetSearchV2 } from './transfer-model';
import type { WorldState } from './world';
import type { Command } from './commands';
import { readCabinetScope } from './cabinet-history';
import { cabinetId, waterId, cabinetDiscoveryFact, cabinetSearchFact, cabinetSearchEventId, cabinetDiscoveryEventId } from './cabinet-model';
import type { CabinetReceipt } from './cabinet-model';
export function canSearchCabinet(world: WorldState, target: string, location = world.player.locationId): boolean {
  const scope = readCabinetScope(world);
  return !!scope && target === cabinetId && location === scope.locationId && world.locations[location]!.light >= .5;
}
export function visibleCabinetTargets(world: WorldState) {
  return world.player.stats.hp > 0 && canSearchCabinet(world, cabinetId) ? [Object.freeze({ targetId: cabinetId, label: '柜子' })] : [];
}
export function createCabinetCandidate(world: WorldState, command: Command) {
  const observedAt = world.campaign.gameClockMinutes + 1, committedRevision = world.campaign.worldRevision + 1;
  const discovered = !world.player.knownFactIds.includes(cabinetDiscoveryFact);
  const legacy: CabinetReceipt = { rule: 'cabinet-search-v1', commandId: command.commandId,
    request: { actorId: command.actorId, locationId: world.player.locationId, cabinetId, expectedWorldRevision: command.expectedWorldRevision },
    elapsedMinutes: 1, observedAt, committedRevision, discoveredItemId: discovered ? waterId : null };
  const receipt: CabinetReceipt | CabinetSearchV2 = readTransferHistory(world)
    ? { ...legacy, rule: 'cabinet-search-v2', waterLocation: world.items[waterId]!.position.kind === 'player' ? 'player' : 'cabinet' } : legacy;
  const fields = { actorId: command.actorId, worldTimeMinutes: observedAt, visibility: 'private' as const, targetIds: [cabinetId] };
  const time = { ...fields, eventId: `evt-${command.commandId}-time`, seq: world.eventJournal.length + 1, type: 'TimeAdvanced',
    payload: { rule: receipt.rule, commandId: command.commandId, fromMinutes: world.campaign.gameClockMinutes, toMinutes: observedAt,
      fromRevision: world.campaign.worldRevision, toRevision: committedRevision } };
  const result = { ...fields, eventId: cabinetSearchEventId(command.commandId), seq: time.seq + 1, type: 'CabinetSearchRecorded', payload: receipt };
  const discovery = { ...fields, eventId: cabinetDiscoveryEventId(command.commandId), seq: time.seq + 2, type: 'CabinetContentDiscovered', targetIds: [waterId],
    payload: { rule: 'cabinet-discovery-v1', commandId: command.commandId, itemId: waterId, cabinetId, locationId: world.player.locationId, observedAt } };
  const knowledge = { knowerId: command.actorId, factId: cabinetSearchFact, source: result.eventId, confidence: 1, observedAt };
  return { ...world, campaign: { ...world.campaign, gameClockMinutes: observedAt, worldRevision: committedRevision },
    player: { ...world.player, knownFactIds: [...world.player.knownFactIds.filter(id => id !== cabinetSearchFact), cabinetSearchFact, ...(discovered ? [cabinetDiscoveryFact] : [])] },
    knowledge: [...world.knowledge.filter(k => k.factId !== cabinetSearchFact), knowledge, ...(discovered ? [{ ...knowledge, factId: cabinetDiscoveryFact, source: discovery.eventId }] : [])],
    eventJournal: [...world.eventJournal, time, result, ...(discovered ? [discovery] : [])],
  };
}
