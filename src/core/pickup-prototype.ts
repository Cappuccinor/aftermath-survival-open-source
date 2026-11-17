import { parseWorldState } from './world';
import { createDoorPrototype,createDoorGame } from './door-prototype';
import { searchScope } from './search';
import { pickupScopeEventId } from './pickup-model';
export function addPickupScope(input:unknown) {
  const world=parseWorldState(input),scope=searchScope(world);
  if(!scope||world.campaign.gameClockMinutes!==0||world.campaign.worldRevision!==0||world.player.stats.carryWeightKg!==0
    ||world.eventJournal.some(e=>e.type==='TimeAdvanced'||e.eventId===pickupScopeEventId)
    ||world.player.knownFactIds.includes(`seen-item-${scope.itemId}`))throw Error('Pickup scope requires pristine scene');
  return parseWorldState({...world,eventJournal:[...world.eventJournal,{eventId:pickupScopeEventId,seq:world.eventJournal.length+1,
    type:'PickupScopeInitialized',actorId:world.player.playerId,targetIds:[scope.itemId],visibility:'private',worldTimeMinutes:0,
    payload:{rule:'pickup-scope-v1',playerId:world.player.playerId,locationId:scope.locationId,searchSourceEventId:'evt-initial-search',
      initialCarryWeightKg:0,initialItem:world.items[scope.itemId]!}}]});
}
export function createPickupPrototype(seed=1){return addPickupScope(createDoorPrototype(seed));}
export function createPickupGame(...args:Parameters<typeof createDoorGame>){return addPickupScope(createDoorGame(...args));}
