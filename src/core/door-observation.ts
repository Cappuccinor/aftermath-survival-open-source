import { readLifecycle } from './npc-lifecycle-history';
import type { DeadDoorReceipt } from './npc-lifecycle-model';
import { doorScopeSchema } from './door-model';
import type { DoorReceipt, DoorScope, DoorWorld } from './door-model';
import { createRng, restoreRng } from './rng';
import type { RngState } from './rng';
import type { Command } from './commands';
import type { WorldEvent } from './events';

export const doorScopeEventId = 'evt-initial-door-gap';
export const doorKnownFactId = (id: string) => `known-door-${id}`;
export const doorResultEventId = (id: string) => `evt-${id}-door`;
export const doorResultFactId = (id: string) => `door-observation-${id}`;
export const doorSoundFactId = (id: string) => `door-heard-${id}`;
const sameRng = (a: RngState, b: RngState) => a.algorithm === b.algorithm && a.state === b.state;

export function readDoorScope(world: DoorWorld): DoorScope | undefined {
  const records = world.eventJournal.filter(e => e.eventId === doorScopeEventId || e.type === 'DoorGapInitialized'
    || (typeof e.payload.rule === 'string' && e.payload.rule.startsWith('door-gap-scope-')));
  if (records.length === 0) {
    if (world.npcs.length) throw new Error('Witness without door scope');
    return;
  }
  const event = records[0]!;
  const scope = doorScopeSchema.parse(event.payload);
  const { doorId, roomId, corridorId, npcId } = scope;
  const fact = world.knowledge.find(k => k.factId === doorKnownFactId(doorId));
  const room = world.locations[roomId], corridor = world.locations[corridorId];
  const occupied = new Set([world.player.playerId, ...Object.keys(world.items), ...Object.keys(world.locations)]);
  const witness = world.npcs[0];
  const route = world.eventJournal.find(e => e.eventId === 'evt-initial-route');
  const routeFact = world.knowledge.find(k => k.factId === 'known-prototype-route');
  if (records.length !== 1 || event.type !== 'DoorGapInitialized' || event.eventId !== doorScopeEventId
    || event.actorId !== world.player.playerId || event.visibility !== 'private' || event.worldTimeMinutes !== 0
    || event.targetIds.length !== 4 || event.targetIds.some((id, i) => id !== [doorId, roomId, corridorId, npcId][i])
    || occupied.has(doorId) || occupied.has(npcId) || doorId === npcId || roomId === corridorId
    || !room?.adjacentLocationIds.includes(corridorId) || !corridor?.adjacentLocationIds.includes(roomId)
    || world.npcs.length !== 1 || !witness || witness.npcId !== npcId || witness.locationId !== corridorId
    || !fact || fact.knowerId !== world.player.playerId || fact.source !== event.eventId || fact.observedAt !== 0
    || fact.confidence !== 1 || fact.expiresAt !== undefined || !world.player.knownFactIds.includes(fact.factId)
    || scope.perception !== (world.player.skills.perception ?? 0) || scope.stealth !== (world.player.skills.stealth ?? 0)
    || scope.corridorLight !== corridor.light || !sameRng(scope.initialRng, createRng(world.campaign.seed).snapshot())
    || world.eventJournal.some(e => e.type === 'TimeAdvanced' && e.seq < event.seq)
    || !route || route.type !== 'KnownRouteInitialized' || route.payload.rule !== 'known-route-v1'
    || Object.keys(route.payload).length !== 3 || route.payload.roomId !== roomId || route.payload.corridorId !== corridorId
    || route.actorId !== world.player.playerId || route.worldTimeMinutes !== 0 || route.visibility !== 'private'
    || route.targetIds.length !== 2 || route.targetIds[0] !== roomId || route.targetIds[1] !== corridorId
    || !routeFact || routeFact.source !== route.eventId || routeFact.observedAt !== 0 || routeFact.confidence !== 1
    || routeFact.expiresAt !== undefined || !world.player.knownFactIds.includes(routeFact.factId)) {
    throw new Error('Invalid door scope');
  }
  return scope;
}

export function canObserveDoor(world: DoorWorld, targetId: string, locationId = world.player.locationId): boolean {
  const scope = readDoorScope(world);
  return !!scope && targetId === scope.doorId && locationId === scope.roomId && scope.gapOpen && scope.corridorLight >= 0.2;
}
export function visibleDoorTargets(world: DoorWorld) {
  const scope = readDoorScope(world);
  return Object.freeze(scope && world.player.stats.hp > 0 && canObserveDoor(world, scope.doorId)
    ? [Object.freeze({ targetId: scope.doorId, label: '门缝' })] : []);
}

export function judgeDoorObservation(scope: Pick<DoorScope, 'perception' | 'stealth' | 'corridorLight'>, alertness: number, before: RngState) {
  const rng = restoreRng(before);
  const visualRoll = rng.nextFloat(), noticeRoll = rng.nextFloat();
  const clamp = (n: number) => Math.max(0.1, Math.min(0.9, n));
  const pSee = clamp(0.30 + scope.perception / 200 + (scope.corridorLight - 0.5) * 0.4);
  const pNotice = clamp(0.40 + (alertness - scope.stealth) / 200);
  const visual = visualRoll >= pSee ? 'none' : visualRoll < pSee / 2 ? 'shoes' : 'shadow';
  const noticed = noticeRoll < pNotice;
  return { visual, noticed, visualRoll, noticeRoll, beforeAlertness: alertness,
    afterAlertness: noticed ? Math.min(100, alertness + 10) : alertness, rngBefore: before, rngAfter: rng.snapshot() } as const;
}

/** Builds an owned candidate only. The engine validates and atomically installs it. */
export function createDoorCandidate<W extends DoorWorld>(world: W, command: Command) {
  const scope = readDoorScope(world);
  if (!scope || !canObserveDoor(world, command.targetIds[0]!)) throw new Error('Unavailable door');
  const witness = world.npcs[0]!;
  const observedAt = world.campaign.gameClockMinutes + 1, committedRevision = world.campaign.worldRevision + 1;
  const dead = readLifecycle(world)?.initialNpc.life.status === 'dead';
  const judgment = dead ? { rule: 'door-observe-v2' as const, ...judgeDeadDoorObservation(scope, witness.alertness, world.rngState) }
    : { rule: 'door-observe-v1' as const, ...judgeDoorObservation(scope, witness.alertness, world.rngState) };
  const receipt: DoorReceipt | DeadDoorReceipt = { commandId: command.commandId,
    request: { actorId: command.actorId, locationId: world.player.locationId, doorId: scope.doorId, expectedWorldRevision: command.expectedWorldRevision },
    elapsedMinutes: 1, committedRevision, observedAt, ...judgment };
  const shared = { worldTimeMinutes: observedAt, actorId: command.actorId, visibility: 'private' as const };
  const events: WorldEvent[] = [
    { ...shared, eventId: `evt-${command.commandId}-time`, seq: world.eventJournal.length + 1,
      type: 'TimeAdvanced', targetIds: [scope.doorId], payload: { rule: receipt.rule, commandId: command.commandId,
        fromMinutes: world.campaign.gameClockMinutes, toMinutes: observedAt, fromRevision: world.campaign.worldRevision, toRevision: committedRevision } },
    { ...shared, eventId: doorResultEventId(command.commandId), seq: world.eventJournal.length + 2,
      type: 'DoorObservationRecorded', targetIds: [scope.doorId], payload: receipt },
  ];
  const knowledge = [{ knowerId: command.actorId, factId: doorResultFactId(command.commandId),
    source: doorResultEventId(command.commandId), confidence: 1, observedAt }];
  const noticeId = `evt-${command.commandId}-door-notice`;
  if (receipt.noticed) {
    events.push({ ...shared, eventId: noticeId, seq: world.eventJournal.length + 3,
      type: 'NPCAlertnessChanged', targetIds: [scope.npcId], payload: { rule: 'door-notice-v1', commandId: command.commandId,
        npcId: scope.npcId, playerId: command.actorId, locationId: scope.roomId, observedAt,
        fromAlertness: receipt.beforeAlertness, toAlertness: receipt.afterAlertness } },
    { ...shared, eventId: `evt-${command.commandId}-door-sound`, seq: world.eventJournal.length + 4,
      type: 'DoorReactionHeard', targetIds: [scope.doorId], payload: { rule: 'door-reaction-v1', commandId: command.commandId,
        doorId: scope.doorId, npcId: scope.npcId, observedAt, cue: 'cloth-rustle-v1' } });
    knowledge.push({ knowerId: command.actorId, factId: doorSoundFactId(command.commandId),
      source: `evt-${command.commandId}-door-sound`, confidence: 1, observedAt });
  }
  return { ...world, campaign: { ...world.campaign, gameClockMinutes: observedAt, worldRevision: committedRevision },
    player: { ...world.player, knownFactIds: [...world.player.knownFactIds, ...knowledge.map(k => k.factId)] },
    npcs: [{ ...witness, alertness: receipt.afterAlertness,
      firstNoticed: witness.firstNoticed ?? (receipt.noticed ? { playerId: command.actorId, locationId: scope.roomId,
        observedAt, sourceEventId: noticeId } : null) }],
    rngState: receipt.rngAfter, knowledge: [...world.knowledge, ...knowledge], eventJournal: [...world.eventJournal, ...events] };
}

/** No notice trial exists for this immutable deceased witness. */
export function judgeDeadDoorObservation(scope: Pick<DoorScope, 'perception' | 'corridorLight'>, alertness: number, before: RngState) {
  const rng = restoreRng(before), visualRoll = rng.nextFloat();
  const pSee = Math.max(0.1, Math.min(0.9, 0.30 + scope.perception / 200 + (scope.corridorLight - 0.5) * 0.4));
  const visual = visualRoll >= pSee ? 'none' : visualRoll < pSee / 2 ? 'shoes' : 'shadow';
  return { visual, noticed: false, noticeRoll: null, noticeCapability: 'absent', visualRoll,
    beforeAlertness: alertness, afterAlertness: alertness, rngBefore: before, rngAfter: rng.snapshot() } as const;
}
