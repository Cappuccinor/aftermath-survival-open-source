import type { WorldState } from '../core/world';
import { readPickupHistory } from '../core/pickup-history';
import { readTransferHistory } from '../core/transfer-history';
import { idSchema } from '../core/schema';
import type { VisibleInventory } from './ports';
const keys=['itemId','label','count','weightKg'] as const;
/** Strict own data properties; malformed projections are unavailable, never fabricated empty. */
export function copyInventory(input:unknown):VisibleInventory|null {
  try {
    if(!Array.isArray(input)||input.length>2||Reflect.ownKeys(input).length!==input.length+1)return null;
    const result=[];
    const ids=new Set<string>();
    for(let n=0;n<input.length;n++){
      const element=Object.getOwnPropertyDescriptor(input,String(n));if(!element||!Object.hasOwn(element,'value'))return null;
      const value:unknown=element.value;if(!value||typeof value!=='object'||Array.isArray(value)||Reflect.ownKeys(value).length!==4)return null;
      const fields:Record<string,unknown>={};
      for(const key of keys){const d=Object.getOwnPropertyDescriptor(value,key);if(!d||!Object.hasOwn(d,'value'))return null;fields[key]=d.value;}
      const controlled=(fields.label==='空罐'&&fields.weightKg===.05)||(fields.label==='瓶装水'&&fields.weightKg===.5);
      if(!idSchema.safeParse(fields.itemId).success||!controlled||fields.count!==1||ids.has(fields.itemId as string))return null;
      ids.add(fields.itemId as string);
      result.push(Object.freeze({itemId:fields.itemId as string,label:fields.label as string,count:1,weightKg:fields.weightKg as number}));
    }
    return Object.freeze(result);
  }catch{return null;}
}
export function projectInventory(world:WorldState):VisibleInventory|null {
  const transfer=readTransferHistory(world);
  if(transfer)return copyInventory([transfer.scope.initialTin,transfer.scope.initialWater]
    .filter(original=>transfer.records.some(record=>record.receipt.request.itemId===original.itemId))
    .map(original=>{const item=world.items[original.itemId]!;return {itemId:item.itemId,label:item.itemId===transfer.scope.initialTin.itemId?'空罐':'瓶装水',count:item.count,weightKg:item.count*item.weightKg};}));
  const history=readPickupHistory(world);if(!history)return null;
  const item=world.items[history.scope.initialItem.itemId]!;
  return copyInventory(history.receipt&&item.position.kind==='player'&&item.position.id===world.player.playerId
    ?[{itemId:item.itemId,label:'空罐',count:item.count,weightKg:item.count*item.weightKg}]:[]);
}
