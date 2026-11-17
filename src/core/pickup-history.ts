import { initialOwnershipView, readTransferHistory, transferPositionAt } from './transfer-history';
import { pickupScopeSchema,pickupReceiptSchema,pickupTimeSchema,pickupScopeEventId,pickupEventId,pickupFactId } from './pickup-model';
import type { PickupWorld,PickupReceipt } from './pickup-model';
import { discoverySchema,searchReceiptSchema,searchScopeSchema } from './search-model';
import { movementReceiptSchema } from './movement';
import type { WorldEvent } from './events';
const reserved=(event:WorldEvent)=>event.payload.rule!=='pick_up-v2'&&(event.type==='ItemPickedUp'||event.type==='PickupScopeInitialized'||event.eventId===pickupScopeEventId
  ||(typeof event.payload.rule==='string'&&/^(pickup-|pick_up-)/.test(event.payload.rule)));
// Compare JSON content independently of object property order; item metadata stays immutable.
function canonical(value:unknown):string {
  if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
  if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical((value as Record<string,unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

/** Audits the one authorized ownership transition; never mutates or restores world state. */
export function readPickupHistory(input:PickupWorld) {
  const world=initialOwnershipView(input);
  const ensure=(condition:boolean)=>{if(!condition)throw Error('Inconsistent pickup history');};
  const scopes=world.eventJournal.filter(e=>e.type==='PickupScopeInitialized'||e.eventId===pickupScopeEventId
    ||(typeof e.payload.rule==='string'&&e.payload.rule.startsWith('pickup-scope-')));
  if(!scopes.length){ensure(!world.eventJournal.some(reserved)&&!world.knowledge.some(k=>k.factId.startsWith('pickup-')));return null;}
  ensure(scopes.length===1);const init=scopes[0]!,scope=pickupScopeSchema.parse(init.payload),original=scope.initialItem;
  const item=world.items[original.itemId],player=world.player.playerId;
  ensure(init.type==='PickupScopeInitialized'&&init.eventId===pickupScopeEventId&&init.worldTimeMinutes===0&&init.actorId===player
    &&init.visibility==='private'&&init.targetIds.length===1&&init.targetIds[0]===original.itemId&&scope.playerId===player);
  ensure(original.typeId==='empty-tin'&&original.count===1&&original.weightKg===.05&&original.position.kind==='location'
    &&original.position.id===scope.locationId&&!!world.locations[scope.locationId]&&!!item);
  if(!item)throw Error('Missing pickup item');
  ensure(canonical({...item,position:original.position})===canonical(original));
  ensure(Object.values(world.items).every(i=>i.itemId===original.itemId||i.position.kind!=='player'));
  const search=world.eventJournal.find(e=>e.eventId===scope.searchSourceEventId),door=world.eventJournal.find(e=>e.eventId==='evt-initial-door-gap');
  const s=searchScopeSchema.parse(search?.payload);
  ensure(!!search&&search.type==='SearchScopeInitialized'&&search.seq<init.seq&&search.worldTimeMinutes===0&&search.actorId===player
    &&search.visibility==='private'&&search.targetIds.length===1&&search.targetIds[0]===scope.locationId
    &&s.itemId===original.itemId&&s.locationId===scope.locationId);
  ensure(!!door&&door.type==='DoorGapInitialized'&&door.seq<init.seq&&door.payload.roomId===scope.locationId);
  const actions=world.eventJournal.filter(e=>e.type==='TimeAdvanced');
  ensure(actions.every((e,n)=>e.seq>init.seq&&e.payload.fromMinutes===n&&e.payload.toMinutes===n+1
    &&e.payload.fromRevision===n&&e.payload.toRevision===n+1&&e.worldTimeMinutes===n+1));
  ensure(world.campaign.gameClockMinutes===actions.length&&world.campaign.worldRevision===actions.length);
  ensure(!world.eventJournal.some(e=>e.type==='ItemInitiallyPerceived'&&e.targetIds.includes(original.itemId)));
  let receipt:PickupReceipt|null=null,transferSeq=Infinity,location=scope.locationId;
  const consumed=new Set<number>([init.seq]);
  const checkEvent=(event:WorldEvent|undefined,type:string,id:string,time:number)=>{
    ensure(!!event&&event.type===type&&event.eventId===id&&event.actorId===player&&event.worldTimeMinutes===time
      &&event.visibility==='private'&&event.targetIds.length===1&&event.targetIds[0]===original.itemId);
    if(event)consumed.add(event.seq);
  };
  for(let n=0;n<world.eventJournal.length;n++){
    const event=world.eventJournal[n]!;
    if(event.type==='PlayerMoved'){
      const move=movementReceiptSchema.parse(event.payload);
      ensure(move.request.locationId===location);location=move.request.destinationId;
    }
    if(event.type!=='ItemPickedUp')continue;
    ensure(receipt===null);receipt=pickupReceiptSchema.parse(event.payload);transferSeq=event.seq;
    const timeEvent=world.eventJournal[n-1],time=pickupTimeSchema.parse(timeEvent?.payload);
    const {commandId,observedAt}=receipt;
    checkEvent(timeEvent,'TimeAdvanced',`evt-${commandId}-time`,observedAt);
    checkEvent(event,'ItemPickedUp',pickupEventId(commandId),observedAt);
    ensure(time.commandId===commandId&&time.toMinutes===observedAt&&time.fromMinutes+1===observedAt
      &&time.toRevision===receipt.committedRevision&&time.fromRevision+1===receipt.committedRevision
      &&receipt.request.expectedWorldRevision===time.fromRevision&&receipt.request.actorId===player
      &&receipt.request.locationId===location&&location===scope.locationId&&receipt.request.itemId===original.itemId
      &&receipt.from.id===scope.locationId&&receipt.to.id===player&&world.locations[location]!.light>=.5
      &&receipt.afterCarryWeightKg===scope.initialCarryWeightKg+original.count*original.weightKg);
    const fact=world.knowledge.find(k=>k.factId===`seen-item-${original.itemId}`);
    const discovery=world.eventJournal.find(e=>e.eventId===receipt!.perceptionSourceEventId);
    const d=discoverySchema.parse(discovery?.payload);
    ensure(!!fact&&!!discovery&&discovery.type==='ItemDiscovered'&&discovery.seq<timeEvent!.seq&&discovery.seq>init.seq
      &&discovery.actorId===player&&discovery.visibility==='private'&&discovery.targetIds.length===1&&discovery.targetIds[0]===original.itemId
      &&discovery.eventId===`evt-${d.commandId}-discovery`&&discovery.worldTimeMinutes===d.observedAt
      &&d.itemId===original.itemId&&d.locationId===scope.locationId&&d.observedAt<=time.fromMinutes
      &&fact.source===discovery.eventId&&fact.knowerId===player&&fact.observedAt===d.observedAt&&fact.confidence===1
      &&fact.expiresAt===undefined&&world.player.knownFactIds.includes(fact.factId));
    const prior=world.eventJournal[discovery!.seq-2],sr=searchReceiptSchema.parse(prior?.payload);
    ensure(prior?.type==='SearchRecorded'&&prior.eventId===`evt-${d.commandId}-search`&&sr.commandId===d.commandId
      &&sr.discoveredItemId===original.itemId&&sr.request.locationId===scope.locationId&&sr.request.actorId===player
      &&sr.observedAt===d.observedAt);
    const picked=world.knowledge.find(k=>k.factId===pickupFactId(original.itemId));
    ensure(!!picked&&picked.source===event.eventId&&picked.knowerId===player&&picked.observedAt===observedAt
      &&picked.confidence===1&&picked.expiresAt===undefined&&world.player.knownFactIds.includes(picked.factId));
  }
  ensure(world.player.locationId===location);
  ensure(canonical(item.position)===canonical(receipt?receipt.to:original.position));
  ensure(world.player.stats.carryWeightKg===(receipt?receipt.afterCarryWeightKg:scope.initialCarryWeightKg));
  for(const event of world.eventJournal)if(reserved(event))ensure(consumed.has(event.seq));
  for(const k of world.knowledge){const source=world.eventJournal.find(e=>e.eventId===k.source);
    if(k.factId.startsWith('pickup-')||(source&&reserved(source)))ensure(!!receipt&&k.factId===pickupFactId(original.itemId)&&k.source===pickupEventId(receipt.commandId));}
  return {scope,receipt,transferSeq};
}
export function itemPositionAt(world:PickupWorld,itemId:string,beforeSeq=Infinity) {
  if(readTransferHistory(world))return transferPositionAt(world,itemId,beforeSeq);
  const history=readPickupHistory(world);
  if(history?.scope.initialItem.itemId===itemId)return history.receipt&&history.transferSeq<beforeSeq?history.receipt.to:history.scope.initialItem.position;
  return world.items[itemId]?.position;
}
