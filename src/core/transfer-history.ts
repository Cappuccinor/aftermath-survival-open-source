import { transferScopeId, transferScopeSchema, transferReceiptSchema, transferTimeSchema, transferEventId, transferFactId, cabinetSearchV2Schema } from './transfer-model';
import type { TransferReceipt } from './transfer-model';
import { pickupScopeSchema } from './pickup-model';
import type { PickupWorld } from './pickup-model';
import { cabinetId, waterId, cabinetScopeSchema, cabinetDiscoverySchema, cabinetDiscoveryFact, cabinetItems } from './cabinet-model';
import { discoverySchema, searchReceiptSchema } from './search-model';
import { movementReceiptSchema } from './movement';
import type { WorldEvent } from './events';
function ensure(condition: unknown): asserts condition { if (!condition) throw Error('Invalid dual transfer history'); }
const reserved = (e: WorldEvent) => e.eventId === transferScopeId || e.type === 'TransferScopeInitialized' || e.type === 'ItemTransferred'
  || (typeof e.payload.rule === 'string' && (e.payload.rule.startsWith('dual-transfer-') || e.payload.rule === 'pick_up-v2'));
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
function envelope(e: WorldEvent | undefined, type: string, id: string, actor: string, target: string, time: number) {
  ensure(e && e.type === type && e.eventId === id && e.actorId === actor && e.visibility === 'private'
    && e.worldTimeMinutes === time && e.targetIds.length === 1 && e.targetIds[0] === target);
}
function knowledge(w: PickupWorld, id: string, source: string, time: number) {
  const k = w.knowledge.find(k => k.factId === id);
  ensure(k && k.knowerId === w.player.playerId && k.source === source && k.observedAt === time && k.confidence === 1
    && k.expiresAt === undefined && w.player.knownFactIds.includes(id));
}

/** Leaf audit: depends only on schemas, never on other world/history validators. */
export function readTransferHistory(world: PickupWorld) {
  const scopes = world.eventJournal.filter(e => e.eventId === transferScopeId || e.type === 'TransferScopeInitialized'
    || (typeof e.payload.rule === 'string' && e.payload.rule.startsWith('dual-transfer-')));
  if (!scopes.length) {
    ensure(!world.eventJournal.some(e => reserved(e) || e.payload.rule === 'cabinet-search-v2')
      && !world.knowledge.some(k => k.factId.startsWith('transfer-')) && !world.player.knownFactIds.some(id => id.startsWith('transfer-')));
    return null;
  }
  ensure(scopes.length === 1);
  const init = scopes[0]!, scope = transferScopeSchema.parse(init.payload), actor = world.player.playerId;
  envelope(init, 'TransferScopeInitialized', transferScopeId, actor, waterId, 0);
  ensure(scope.playerId === actor && !!world.locations[scope.locationId]);
  const p = world.eventJournal.find(e => e.eventId === scope.pickupSourceEventId), c = world.eventJournal.find(e => e.eventId === scope.cabinetSourceEventId);
  const pickup = pickupScopeSchema.parse(p?.payload), cabinet = cabinetScopeSchema.parse(c?.payload);
  ensure(p && c && p.seq < c.seq && c.seq + 1 === init.seq && p.type === 'PickupScopeInitialized' && c.type === 'CabinetSceneInitialized'
    && p.actorId === actor && c.actorId === actor && p.worldTimeMinutes === 0 && c.worldTimeMinutes === 0
    && pickup.playerId === actor && cabinet.playerId === actor && pickup.locationId === scope.locationId && cabinet.locationId === scope.locationId);
  ensure(canonical(scope.initialTin) === canonical(pickup.initialItem) && scope.initialTin.itemId === 'prototype-tin'
    && scope.initialTin.typeId === 'empty-tin' && scope.initialTin.count === 1 && scope.initialTin.weightKg === .05
    && scope.initialTin.position.kind === 'location' && scope.initialTin.position.id === scope.locationId);
  ensure(canonical(scope.initialWater) === canonical(cabinetItems(scope.locationId)[waterId]));
  const originals = [scope.initialTin, scope.initialWater];
  const actions = world.eventJournal.filter(e => e.type === 'TimeAdvanced');
  ensure(actions.every((e, n) => e.seq > init.seq && e.payload.fromMinutes === n && e.payload.toMinutes === n + 1
    && e.payload.fromRevision === n && e.payload.toRevision === n + 1 && e.worldTimeMinutes === n + 1));
  ensure(world.campaign.gameClockMinutes === actions.length && world.campaign.worldRevision === actions.length);
  // Capability starts before actions; old transfer/search records retain their meaning only in old worlds.
  ensure(!world.eventJournal.some(e => e.type === 'ItemPickedUp' || e.payload.rule === 'pick_up-v1' || e.payload.rule === 'cabinet-search-v1'));
  let location = scope.locationId, grams = 0;
  const records: { receipt: TransferReceipt; seq: number }[] = [], consumed = new Set([init.eventId]), ids = new Set<string>();
  for (let i = 0; i < world.eventJournal.length; i++) {
    const e = world.eventJournal[i]!;
    if (e.type === 'PlayerMoved') { const move = movementReceiptSchema.parse(e.payload); ensure(move.request.locationId === location); location = move.request.destinationId; }
    if (e.type !== 'ItemTransferred') continue;
    const r = transferReceiptSchema.parse(e.payload), { request, commandId, observedAt } = r, timeEvent = world.eventJournal[i - 1], time = transferTimeSchema.parse(timeEvent?.payload);
    const original = originals.find(item => item.itemId === request.itemId); ensure(original);
    envelope(timeEvent, 'TimeAdvanced', `evt-${commandId}-time`, actor, original.itemId, observedAt);
    envelope(e, 'ItemTransferred', transferEventId(commandId), actor, original.itemId, observedAt);
    ensure(time.commandId === commandId && time.fromMinutes + 1 === observedAt && time.toMinutes === observedAt
      && time.fromRevision + 1 === r.committedRevision && time.toRevision === r.committedRevision && request.expectedWorldRevision === time.fromRevision);
    ensure(request.actorId === actor && request.locationId === location && location === scope.locationId && world.locations[location]!.light >= .5
      && canonical(r.from) === canonical(original.position) && r.to.id === actor && r.weightKg === original.weightKg
      && !records.some(x => x.receipt.request.itemId === original.itemId) && !ids.has(commandId));
    ensure(r.beforeCarryWeightKg === grams / 1000); grams += original.itemId === waterId ? 500 : 50; ensure(r.afterCarryWeightKg === grams / 1000);
    const discovery = world.eventJournal.find(d => d.eventId === r.perceptionSourceEventId); ensure(discovery && discovery.seq < timeEvent!.seq && discovery.seq > init.seq);
    const isWater = original.itemId === waterId;
    const d = isWater ? cabinetDiscoverySchema.parse(discovery.payload) : discoverySchema.parse(discovery.payload);
    envelope(discovery, isWater ? 'CabinetContentDiscovered' : 'ItemDiscovered', `evt-${d.commandId}-${isWater ? 'cabinet-discovery' : 'discovery'}`, actor, original.itemId, d.observedAt);
    ensure(d.itemId === original.itemId && d.locationId === scope.locationId && d.observedAt <= time.fromMinutes);
    const searchEvent = world.eventJournal[discovery.seq - 2];
    const search = isWater ? cabinetSearchV2Schema.parse(searchEvent?.payload) : searchReceiptSchema.parse(searchEvent?.payload);
    ensure(searchEvent && searchEvent.type === (isWater ? 'CabinetSearchRecorded' : 'SearchRecorded')
      && search.commandId === d.commandId && search.request.actorId === actor && search.request.locationId === scope.locationId
      && search.discoveredItemId === original.itemId && search.observedAt === d.observedAt);
    if (search.rule === 'cabinet-search-v2') ensure(search.waterLocation === 'cabinet');
    knowledge(world, isWater ? cabinetDiscoveryFact : `seen-item-${original.itemId}`, discovery.eventId, d.observedAt);
    knowledge(world, transferFactId(original.itemId), e.eventId, observedAt);
    records.push({ receipt: r, seq: e.seq }); ids.add(commandId); consumed.add(timeEvent!.eventId); consumed.add(e.eventId);
  }
  ensure(location === world.player.locationId && world.player.stats.carryWeightKg === grams / 1000);
  for (const original of originals) {
    const current = world.items[original.itemId], transfer = records.find(r => r.receipt.request.itemId === original.itemId);
    ensure(current && canonical({ ...current, position: original.position }) === canonical(original)
      && canonical(current.position) === canonical(transfer ? transfer.receipt.to : original.position));
  }
  ensure(Object.values(world.items).every(i => i.position.kind !== 'player' || originals.some(o => o.itemId === i.itemId)));
  for (const e of world.eventJournal) if (reserved(e)) ensure(consumed.has(e.eventId));
  for (const k of world.knowledge) {
    const source = world.eventJournal.find(e => e.eventId === k.source);
    if (k.factId.startsWith('transfer-') || (source && reserved(source))) ensure(records.some(r => k.factId === transferFactId(r.receipt.request.itemId) && k.source === transferEventId(r.receipt.commandId)));
  }
  return { scope, records, carryWeightKg: grams / 1000 };
}

/** A proven initial ownership view for old strict initialization checks, never a mutation or migration. */
export function initialOwnershipView<T extends PickupWorld>(world: T): T {
  const history = readTransferHistory(world); if (!history) return world;
  return { ...world, items: { ...world.items, [history.scope.initialTin.itemId]: history.scope.initialTin, [waterId]: history.scope.initialWater },
    player: { ...world.player, stats: { ...world.player.stats, carryWeightKg: 0 } } };
}
export function transferPositionAt(world: PickupWorld, itemId: string, beforeSeq = Infinity) {
  const history = readTransferHistory(world); if (!history) return undefined;
  const original = [history.scope.initialTin, history.scope.initialWater].find(i => i.itemId === itemId);
  if (!original) return world.items[itemId]?.position;
  const record = history.records.find(r => r.receipt.request.itemId === itemId && r.seq < beforeSeq);
  return record ? record.receipt.to : original.position;
}
