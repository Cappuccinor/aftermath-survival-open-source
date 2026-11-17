import { initialOwnershipView, readTransferHistory, transferPositionAt } from './transfer-history';
import { cabinetSearchV2Schema } from './transfer-model';
import type { CabinetSearchV2 } from './transfer-model';
import { readBuildingScene } from './building-scene';
import { movementReceiptSchema } from './movement';
import type { WorldEvent } from './events';
import { cabinetId, waterId, cabinetScopeId, cabinetKnownFact, cabinetDiscoveryFact, cabinetSearchFact,
  cabinetScopeSchema, cabinetReceiptSchema, cabinetDiscoverySchema, cabinetTimeSchema, cabinetItems,
  cabinetSearchEventId, cabinetDiscoveryEventId } from './cabinet-model';
import type { CabinetWorld, CabinetReceipt } from './cabinet-model';
function ensure(condition: unknown): asserts condition { if (!condition) throw Error('Invalid cabinet scene or history'); }
const reserved = (e: WorldEvent) => ['CabinetSceneInitialized', 'CabinetSearchRecorded', 'CabinetContentDiscovered'].includes(e.type)
  || e.eventId === cabinetScopeId || (typeof e.payload.rule === 'string' && e.payload.rule.startsWith('cabinet-'));
const relatedFact = (id: string) => id.startsWith('cabinet-') || id === `seen-item-${waterId}` || id === `seen-item-${cabinetId}`;
function evidence(world: CabinetWorld, factId: string, source: string, time: number) {
  const fact = world.knowledge.find(k => k.factId === factId);
  ensure(fact && fact.knowerId === world.player.playerId && fact.source === source && fact.confidence === 1
    && fact.observedAt === time && fact.expiresAt === undefined && world.player.knownFactIds.includes(factId));
}
function envelope(event: WorldEvent | undefined, type: string, id: string, target: string, time: number, actor: string) {
  ensure(event && event.type === type && event.eventId === id && event.targetIds.length === 1 && event.targetIds[0] === target
    && event.actorId === actor && event.visibility === 'private' && event.worldTimeMinutes === time);
}

/** Optional scope; reserved entities never appear by implicit migration or orphan evidence. */
export function readCabinetScope(world: CabinetWorld) {
  const scopes = world.eventJournal.filter(e => e.type === 'CabinetSceneInitialized' || e.eventId === cabinetScopeId
    || (typeof e.payload.rule === 'string' && e.payload.rule.startsWith('cabinet-scope-')));
  if (!scopes.length) {
    ensure(!world.eventJournal.some(reserved) && !world.knowledge.some(k => relatedFact(k.factId))
      && !world.player.knownFactIds.some(relatedFact)
      && !Object.values(world.items).some(i => [cabinetId, waterId].includes(i.itemId) || ['wooden-cabinet', 'bottled-water'].includes(i.typeId)));
    return null;
  }
  ensure(scopes.length === 1);
  const init = scopes[0]!, scope = cabinetScopeSchema.parse(init.payload), building = readBuildingScene(world);
  ensure(building && scope.locationId === building.roomId && scope.playerId === world.player.playerId);
  envelope(init, 'CabinetSceneInitialized', cabinetScopeId, cabinetId, 0, world.player.playerId);
  const parent = world.eventJournal.find(e => e.eventId === scope.buildingSourceEventId);
  ensure(parent && parent.seq + 1 === init.seq);
  ensure(world.eventJournal.every(e => e.type !== 'TimeAdvanced' || e.seq > init.seq));
  const originals = cabinetItems(scope.locationId), initial = initialOwnershipView(world);
  for (const id of [cabinetId, waterId] as const) {
    const actual = initial.items[id], original = originals[id]!;
    ensure(actual && actual.typeId === original.typeId && actual.position.kind === original.position.kind && actual.position.id === original.position.id
      && actual.count === 1 && actual.weightKg === original.weightKg && actual.durability === 100 && actual.condition === original.condition
      && Object.keys(actual.metadata).length === 0);
  }
  ensure(Object.values(world.items).every(i => [cabinetId, waterId].includes(i.itemId)
    || (!['wooden-cabinet', 'bottled-water'].includes(i.typeId) && !(i.position.kind === 'container' && i.position.id === cabinetId))));
  evidence(world, cabinetKnownFact, cabinetScopeId, 0);
  return scope;
}

/** Audit against the event cursor, never against the player's final location. */
export function validateCabinetHistory(world: CabinetWorld) {
  const scope = readCabinetScope(world); if (!scope) return;
  let location = scope.locationId, first: CabinetReceipt | CabinetSearchV2 | undefined, latest: CabinetReceipt | CabinetSearchV2 | undefined;
  const consumed = new Set<string>([cabinetScopeId]), commands = new Set<string>();
  for (let i = 0; i < world.eventJournal.length; i++) {
    const event = world.eventJournal[i]!;
    if (event.type === 'PlayerMoved') {
      const move = movementReceiptSchema.parse(event.payload);
      ensure(move.request.locationId === location); location = move.request.destinationId;
    }
    if (event.type !== 'CabinetSearchRecorded') continue;
    const transfer = readTransferHistory(world);
    const receipt = transfer ? cabinetSearchV2Schema.parse(event.payload) : cabinetReceiptSchema.parse(event.payload), { commandId, observedAt, request } = receipt;
    const timeEvent = world.eventJournal[i - 1], time = (transfer ? cabinetTimeSchema.extend({ rule: cabinetSearchV2Schema.shape.rule }) : cabinetTimeSchema).parse(timeEvent?.payload);
    if (receipt.rule === 'cabinet-search-v2') ensure(receipt.waterLocation === (transferPositionAt(world, waterId, timeEvent!.seq)?.kind === 'player' ? 'player' : 'cabinet'));
    envelope(timeEvent, 'TimeAdvanced', `evt-${commandId}-time`, cabinetId, observedAt, scope.playerId);
    envelope(event, 'CabinetSearchRecorded', cabinetSearchEventId(commandId), cabinetId, observedAt, scope.playerId);
    ensure(time.commandId === commandId && time.fromMinutes + 1 === observedAt && time.toMinutes === observedAt
      && time.fromRevision + 1 === receipt.committedRevision && time.toRevision === receipt.committedRevision
      && request.expectedWorldRevision === time.fromRevision && request.actorId === scope.playerId
      && request.locationId === location && location === scope.locationId && world.locations[location]!.light >= .5
      && receipt.discoveredItemId === (first ? null : waterId) && !commands.has(commandId));
    consumed.add(timeEvent!.eventId); consumed.add(event.eventId); commands.add(commandId); latest = receipt;
    if (!first) {
      const discovery = world.eventJournal[++i], d = cabinetDiscoverySchema.parse(discovery?.payload);
      envelope(discovery, 'CabinetContentDiscovered', cabinetDiscoveryEventId(commandId), waterId, observedAt, scope.playerId);
      ensure(d.commandId === commandId && d.locationId === location && d.observedAt === observedAt);
      evidence(world, cabinetDiscoveryFact, discovery!.eventId, observedAt);
      consumed.add(discovery!.eventId); first = receipt;
    }
  }
  ensure(location === world.player.locationId);
  if (latest) evidence(world, cabinetSearchFact, cabinetSearchEventId(latest.commandId), latest.observedAt);
  for (const event of world.eventJournal) if (reserved(event)) ensure(consumed.has(event.eventId));
  const allowed = new Set([cabinetKnownFact, ...(first ? [cabinetDiscoveryFact, cabinetSearchFact] : [])]);
  for (const fact of world.knowledge) {
    const event = world.eventJournal.find(e => e.eventId === fact.source);
    if (relatedFact(fact.factId) || (event && reserved(event))) ensure(allowed.has(fact.factId));
  }
  for (const id of world.player.knownFactIds) if (relatedFact(id)) ensure(allowed.has(id));
}
