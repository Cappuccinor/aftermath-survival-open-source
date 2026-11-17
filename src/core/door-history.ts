import { readLifecycle } from './npc-lifecycle-history';
import { anyDoorReceiptSchema } from './npc-lifecycle-model';
import { doorNoticeSchema, doorSoundSchema } from './door-model';
import type { DoorWitness, DoorWorld } from './door-model';
import type { WorldEvent } from './events';
import { canObserveDoor, doorKnownFactId, doorResultEventId, doorResultFactId, doorScopeEventId,
  doorSoundFactId, judgeDoorObservation, judgeDeadDoorObservation, readDoorScope } from './door-observation';

const doorTypes = new Set(['DoorObservationRecorded', 'NPCAlertnessChanged', 'DoorReactionHeard']);
const doorRules = new Set(['door-observe-v1', 'door-observe-v2', 'door-notice-v1', 'door-reaction-v1']);
const isDoorEvent = (e: WorldEvent) => doorTypes.has(e.type)
  || (typeof e.payload.rule === 'string' && e.payload.rule.startsWith('door-') && e.payload.rule !== 'door-gap-scope-v1');

/** Reconstructs only the new static domain. Existing receipt validation still checks every old action. */
export function validateDoorHistory(world: DoorWorld): void {
  const scope = readDoorScope(world);
  const ensure = (condition: boolean) => { if (!condition) throw new Error('Inconsistent door history'); };
  if (!scope) {
    ensure(!world.eventJournal.some(isDoorEvent));
    return;
  }
  const dead = readLifecycle(world)?.initialNpc.life.status === 'dead';
  let rng = scope.initialRng, alertness = scope.initialAlertness;
  let first: DoorWitness['firstNoticed'] = null;
  const consumed = new Set<number>();
  const expectedFacts = new Map<string, { source: string; observedAt: number }>([
    [doorKnownFactId(scope.doorId), { source: doorScopeEventId, observedAt: 0 }],
  ]);
  const actions = world.eventJournal.filter(e => e.type === 'TimeAdvanced');
  ensure(world.campaign.gameClockMinutes === actions.length && world.campaign.worldRevision === actions.length);
  actions.forEach((e, n) => ensure(e.payload.fromMinutes === n && e.payload.toMinutes === n + 1
    && e.payload.fromRevision === n && e.payload.toRevision === n + 1 && e.worldTimeMinutes === n + 1));
  if (actions.length === 0) ensure(world.player.locationId === scope.roomId);
  const checkEvent = (event: WorldEvent | undefined, type: string, id: string, target: string, time: number) => {
    ensure(!!event && event.type === type && event.eventId === id && event.actorId === world.player.playerId
      && event.targetIds.length === 1 && event.targetIds[0] === target && event.worldTimeMinutes === time && event.visibility === 'private');
    if (event) consumed.add(event.seq);
  };
  for (let i = 0; i < world.eventJournal.length; i++) {
    const event = world.eventJournal[i]!;
    if (event.type !== 'DoorObservationRecorded') continue;
    const receipt = anyDoorReceiptSchema.parse(event.payload);
    ensure(receipt.rule === (dead ? 'door-observe-v2' : 'door-observe-v1'));
    const { commandId, observedAt } = receipt;
    const time = world.eventJournal[i - 1];
    ensure(!!time && time.type === 'TimeAdvanced' && time.payload.rule === receipt.rule
      && time.payload.commandId === commandId && time.payload.toMinutes === observedAt
      && time.payload.toRevision === receipt.committedRevision && time.payload.fromRevision === receipt.request.expectedWorldRevision);
    ensure(receipt.request.actorId === world.player.playerId && receipt.request.locationId === scope.roomId
      && receipt.request.doorId === scope.doorId && canObserveDoor(world, scope.doorId, receipt.request.locationId));
    checkEvent(time, 'TimeAdvanced', `evt-${commandId}-time`, scope.doorId, observedAt);
    checkEvent(event, 'DoorObservationRecorded', doorResultEventId(commandId), scope.doorId, observedAt);
    const expected = dead ? judgeDeadDoorObservation(scope, alertness, rng) : judgeDoorObservation(scope, alertness, rng);
    ensure(receipt.visual === expected.visual && receipt.noticed === expected.noticed
      && receipt.visualRoll === expected.visualRoll && receipt.noticeRoll === expected.noticeRoll
      && receipt.beforeAlertness === alertness && receipt.afterAlertness === expected.afterAlertness
      && receipt.rngBefore.state === rng.state && receipt.rngBefore.algorithm === rng.algorithm
      && receipt.rngAfter.state === expected.rngAfter.state && receipt.rngAfter.algorithm === expected.rngAfter.algorithm);
    rng = expected.rngAfter; alertness = expected.afterAlertness;
    ensure(!expectedFacts.has(doorResultFactId(commandId)));
    expectedFacts.set(doorResultFactId(commandId), { source: event.eventId, observedAt });
    if (receipt.noticed) {
      const notice = world.eventJournal[++i], sound = world.eventJournal[++i];
      const noticeId = `evt-${commandId}-door-notice`, soundId = `evt-${commandId}-door-sound`;
      checkEvent(notice, 'NPCAlertnessChanged', noticeId, scope.npcId, observedAt);
      checkEvent(sound, 'DoorReactionHeard', soundId, scope.doorId, observedAt);
      const n = doorNoticeSchema.parse(notice?.payload), s = doorSoundSchema.parse(sound?.payload);
      ensure(n.commandId === commandId && n.npcId === scope.npcId && n.playerId === world.player.playerId
        && n.locationId === scope.roomId && n.observedAt === observedAt
        && n.fromAlertness === receipt.beforeAlertness && n.toAlertness === receipt.afterAlertness);
      ensure(s.commandId === commandId && s.npcId === scope.npcId && s.doorId === scope.doorId && s.observedAt === observedAt);
      first ??= { playerId: world.player.playerId, locationId: scope.roomId, observedAt, sourceEventId: noticeId };
      expectedFacts.set(doorSoundFactId(commandId), { source: soundId, observedAt });
    }
  }
  ensure(world.rngState.state === rng.state && world.rngState.algorithm === rng.algorithm);
  const witness = world.npcs[0]!;
  ensure(witness.alertness === alertness);
  ensure(first === null ? witness.firstNoticed === null : !!witness.firstNoticed
    && witness.firstNoticed.playerId === first.playerId && witness.firstNoticed.locationId === first.locationId
    && witness.firstNoticed.observedAt === first.observedAt && witness.firstNoticed.sourceEventId === first.sourceEventId);
  for (const event of world.eventJournal) {
    if (isDoorEvent(event)) ensure(consumed.has(event.seq) && doorRules.has(String(event.payload.rule)));
  }
  for (const [factId, expected] of expectedFacts) {
    const fact = world.knowledge.find(k => k.factId === factId);
    ensure(!!fact && fact.knowerId === world.player.playerId && fact.source === expected.source
      && fact.observedAt === expected.observedAt && fact.confidence === 1 && fact.expiresAt === undefined
      && world.player.knownFactIds.includes(factId));
  }
  for (const fact of world.knowledge) {
    const source = world.eventJournal.find(e => e.eventId === fact.source);
    if (fact.factId.startsWith('known-door-') || fact.factId.startsWith('door-observation-') || fact.factId.startsWith('door-heard-')
      || source?.type === 'DoorGapInitialized' || (source && isDoorEvent(source))) ensure(expectedFacts.has(fact.factId));
  }
}
