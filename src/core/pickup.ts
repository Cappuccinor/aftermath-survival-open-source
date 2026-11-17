import { readTransferHistory } from './transfer-history';
import { canTransfer } from './transfer';
import { waterId } from './cabinet-model';
import type { WorldState } from './world';
import type { Command } from './commands';
import type { PickupReceipt } from './pickup-model';
import { pickupEventId,pickupFactId } from './pickup-model';
import { readPickupHistory } from './pickup-history';
import { canPerceiveInspectableItem,seenItemFactId } from './inspection';
export function canPickUp(world:WorldState,itemId:string) {
  if(readTransferHistory(world))return canTransfer(world,itemId);
  const history=readPickupHistory(world);
  return !!history&&!history.receipt&&history.scope.initialItem.itemId===itemId&&world.player.stats.hp>0
    &&canPerceiveInspectableItem(world,itemId);
}
export function visiblePickupTargets(world:WorldState) {
  const transfer=readTransferHistory(world);
  if(transfer)return Object.freeze([transfer.scope.initialTin.itemId,waterId].filter(id=>canTransfer(world,id)).map(id=>Object.freeze({targetId:id,label:id===waterId?'瓶装水':'空罐'})));
  const history=readPickupHistory(world),id=history?.scope.initialItem.itemId;
  return Object.freeze(id&&canPickUp(world,id)?[Object.freeze({targetId:id,label:'空罐'})]:[]);
}
export function createPickupCandidate(world:WorldState,command:Command) {
  const itemId=command.targetIds[0]!,item=world.items[itemId]!,player=world.player.playerId;
  const observedAt=world.campaign.gameClockMinutes+1,committedRevision=world.campaign.worldRevision+1;
  const receipt:PickupReceipt={rule:'pick_up-v1',commandId:command.commandId,
    request:{actorId:player,locationId:world.player.locationId,itemId,expectedWorldRevision:command.expectedWorldRevision},
    elapsedMinutes:1,observedAt,committedRevision,from:{kind:'location',id:world.player.locationId},to:{kind:'player',id:player},
    count:1,weightKg:.05,beforeCarryWeightKg:0,afterCarryWeightKg:.05,
    perceptionSourceEventId:world.knowledge.find(k=>k.factId===seenItemFactId(itemId))!.source};
  const common={actorId:player,targetIds:[itemId],visibility:'private' as const,worldTimeMinutes:observedAt};
  const time={...common,eventId:`evt-${command.commandId}-time`,seq:world.eventJournal.length+1,type:'TimeAdvanced',payload:{rule:receipt.rule,commandId:command.commandId,
    fromMinutes:world.campaign.gameClockMinutes,toMinutes:observedAt,fromRevision:world.campaign.worldRevision,toRevision:committedRevision}};
  const event={...common,eventId:pickupEventId(command.commandId),seq:world.eventJournal.length+2,type:'ItemPickedUp',payload:receipt};
  const fact={factId:pickupFactId(itemId),knowerId:player,source:event.eventId,confidence:1,observedAt};
  return {...world,campaign:{...world.campaign,gameClockMinutes:observedAt,worldRevision:committedRevision},
    items:{...world.items,[itemId]:{...item,position:receipt.to}},
    player:{...world.player,stats:{...world.player.stats,carryWeightKg:world.player.stats.carryWeightKg+item.count*item.weightKg},knownFactIds:[...world.player.knownFactIds,fact.factId]},
    knowledge:[...world.knowledge,fact],eventJournal:[...world.eventJournal,time,event]};
}
