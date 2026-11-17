import type { WorldState } from './world';
import { knownRoute } from './movement';
import { searchScopeSchema } from './search-model';
import { itemPositionAt } from './pickup-history';
import { visibleCabinetTargets } from './cabinet-search';
export { searchReceiptSchema, discoverySchema } from './search-model';
export type { SearchReceipt } from './search-model';
export function searchScope(world:WorldState){
 const event=world.eventJournal.find(e=>e.eventId==='evt-initial-search');
 if(!event)return;
 const parsed=searchScopeSchema.safeParse(event.payload); if(!parsed.success)throw new Error('Invalid search scope');
 const {locationId,itemId}=parsed.data, item=world.items[itemId];
 const initialPosition=itemPositionAt(world,itemId,0);
 if(event.type!=='SearchScopeInitialized'||event.worldTimeMinutes!==0||event.actorId!==world.player.playerId||event.visibility!=='private'
 ||event.targetIds.length!==1||event.targetIds[0]!==locationId||knownRoute(world)?.roomId!==locationId
 ||!item||item.typeId!=='empty-tin'||initialPosition?.kind!=='location'||initialPosition.id!==locationId)throw new Error('Invalid search scope');
 return parsed.data;
}
export function canSearch(world:WorldState,target:string,location=world.player.locationId){
 const scope=searchScope(world);return !!scope&&target===scope.locationId&&location===target&&world.locations[target]!.light>=0.5;
}
export function visibleSearchTargets(world:WorldState){
 return Object.freeze([...(world.player.stats.hp>0&&canSearch(world,world.player.locationId)?[Object.freeze({targetId:world.player.locationId,label:'房间'})]:[]), ...visibleCabinetTargets(world)]);
}
