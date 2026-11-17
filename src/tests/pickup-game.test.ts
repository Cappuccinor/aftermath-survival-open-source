import { expect,test } from 'vitest';
import { createGame } from '../application/game';
import { copyInventory,projectInventory } from '../application/inventory';
import { createPickupPrototype } from '../core/pickup-prototype';
import { createDoorPrototype } from '../core/door-prototype';
import { action,clone,discovered,pickupCommand,room,tin } from './pickup-fixtures';
const entry={itemId:tin,label:'空罐',count:1,weightKg:.05};
test('only proven carried item is projected; unavailable legacy, empty new world and frozen copy are distinct',()=>{
 expect(projectInventory(createDoorPrototype())).toBeNull();expect(projectInventory(createPickupPrototype())).toEqual([]);
 const e=discovered();e.dispatch(pickupCommand());const inventory=projectInventory(e.snapshot());expect(inventory).toEqual([entry]);
 expect(Object.isFrozen(inventory)).toBe(true);expect(Object.isFrozen(inventory![0])).toBe(true);
 const source=[{...entry}],copy=copyInventory(source);source[0]!.count=99;expect(copy).toEqual([entry]);expect(Object.isFrozen(copy![0])).toBe(true);
});
test.each([undefined,null,{},[null],[{}],[{...entry,itemId:''}],[{...entry,label:'秘密'}],[{...entry,count:0}],[{...entry,count:2}],
 [{...entry,weightKg:NaN}],[{...entry,weightKg:Infinity}],[{...entry,weightKg:-1}],[{...entry,weightKg:.1}],
 [{...entry,metadata:{secret:'x'}}],[entry,entry]])('invalid inventory is unavailable, never invented empty: %j',input=>expect(copyInventory(input)).toBeNull());
test('inherited/accessor/sparse/revoked entries rejected without invoking data getters',()=>{
 let calls=0;const accessor={...entry};Object.defineProperty(accessor,'count',{get(){calls++;return 1;}});
 const revoked=Proxy.revocable([],{});revoked.revoke();
 for(const value of [[Object.create(entry)],[accessor],new Array(1),revoked.proxy])expect(copyInventory(value)).toBeNull();
 expect(calls).toBe(0);
});
test('visible result, targets, weight and inventory align before/after pickup and older retries',async()=>{
 const game=createGame(createPickupPrototype());const initial=await game.dispatch(action('observe',0));
 expect(initial).toMatchObject({ok:true,inventory:[],pickupTargets:[]});expect(JSON.stringify(initial)).not.toContain('prototype-tin');
 const search=action('search',1,room);expect(await game.dispatch(search)).toMatchObject({ok:true,pickupTargets:[{targetId:tin,label:'空罐'}]});
 const before=await game.dispatch(action('inspect',2,tin));expect(before).toMatchObject({ok:true,inventory:[]});
 const cmd=pickupCommand(3),result=await game.dispatch(cmd);expect(result).toMatchObject({ok:true,inventory:[entry],pickupTargets:[],inspectTargets:[],playerStatus:{carryWeightKg:.05},outcome:{summary:'你花了一分钟拾起空罐。',facts:[]},persistence:{ok:false}});
 expect(JSON.stringify(result)).not.toMatch(/metadata|rng|noticed|alertness|durability|perceptionSource|prototype-witness/);
 const again=await game.dispatch(cmd);expect(again).toMatchObject({ok:true,replayed:true,clock:{worldRevision:4},inventory:[entry]});
 const prior=await game.dispatch(search);expect(prior).toMatchObject({ok:true,replayed:true,committedRevision:2,clock:{worldRevision:4},inventory:[entry],pickupTargets:[]});
 expect(await game.dispatch(pickupCommand(4))).toEqual({ok:false,code:'invalid_target'});
});
test('unknown, undiscovered and hidden target failures are identical and reveal nothing',async()=>{
 const outputs=[];for(const id of [tin,'unknown','prototype-witness'])outputs.push(await createGame(createPickupPrototype()).dispatch({...pickupCommand(0),targetIds:[id]}));
 expect(outputs).toEqual(Array(3).fill({ok:false,code:'invalid_target'}));
});
