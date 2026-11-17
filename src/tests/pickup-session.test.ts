import { afterEach,expect,test,vi } from 'vitest';
import { createObservationSession } from '../application/session';
import { createGame } from '../application/game';
import { projectInventory } from '../application/inventory';
import { projectClock } from '../application/clock';
import { projectPlayerStatus } from '../application/player-status';
import type {ActionReply,GameClient} from '../application/ports';
import { localIntentInterpreter } from '../adapters/ai/local-intent';
import { createEngine } from '../core/engine';
import { visiblePickupTargets } from '../core/pickup';
import { discovered,tin } from './pickup-fixtures';
const world=()=>discovered().snapshot();
function make(client:GameClient,interpret=localIntentInterpreter.interpret){const w=world();return createObservationSession({client,interpreter:{interpret},actorId:w.player.playerId,
 initialClock:projectClock(w),initialPlayerStatus:projectPlayerStatus(w),initialPickupTargets:visiblePickupTargets(w),initialInventory:projectInventory(w),timeoutMs:20});}
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>resolve=r);return{promise,resolve};}
afterEach(()=>vi.useRealTimers());
test('button and three full texts share command/world, interpreter sees only public pickup target',async()=>{
 const worlds=[];for(const phrase of [null,'拾取空罐','捡起空罐','拿起空罐']){
  const commands:unknown[]=[],game=createGame(world()),interpret=vi.fn(localIntentInterpreter.interpret),s=make({dispatch:c=>{commands.push(c);return game.dispatch(c);}},interpret);
  if(phrase===null)await s.pickUp(tin);else{s.setDraft(phrase);await s.submitText();}
  expect(commands).toHaveLength(1);expect(commands[0]).toMatchObject({verb:'pick_up',targetIds:[tin],arguments:{},toolIds:[]});
  expect(s.read()).toMatchObject({phase:'success',draft:'',inventory:[{itemId:tin,count:1,weightKg:.05}],pickupTargets:[],playerStatus:{carryWeightKg:.05}});
  if(phrase){expect(interpret.mock.calls[0]![0].pickupTargets).toEqual([{targetId:tin,label:'空罐'}]);expect(JSON.stringify(interpret.mock.calls)).not.toMatch(/metadata|rng|npc|inventory/i);}
  const e=createEngine(world());expect(e.dispatch(commands[0]).ok).toBe(true);worlds.push(e.snapshot());
 }for(const w of worlds)expect(w).toEqual(worlds[0]);
});
test.each(['我准备拾取空罐','不要拾取空罐','拾取空罐并离开','拾取2个空罐','拾取柜内空罐','拿起prototype-tin','拾取未知物品'])('refuses %s preserves values/draft and recovers',async phrase=>{
 const game=createGame(world()),dispatch=vi.fn(game.dispatch),s=make({dispatch});const initial=s.read();s.setDraft(phrase);await s.submitText();
 expect(dispatch).not.toHaveBeenCalled();expect(s.read()).toMatchObject({phase:'error',draft:phrase,inventory:[],pickupTargets:initial.pickupTargets,clock:initial.clock});
 s.setDraft('捡起空罐');await s.submitText();expect(s.read().phase).toBe('success');
});
test('pending, timeout, late reply and retry retain draft and original command; confirmed once',async()=>{
 vi.useFakeTimers();const late=deferred<ActionReply>(),game=createGame(world());const cmds:unknown[]=[];let stored!:ActionReply;
 const s=make({dispatch:async c=>{cmds.push(c);stored=await game.dispatch(c);return cmds.length===1?late.promise:stored;}});
 s.setDraft('捡起空罐');const pending=s.submitText();await vi.advanceTimersByTimeAsync(1);const initial=s.read();
 expect(initial).toMatchObject({phase:'pending',inventory:[],playerStatus:{carryWeightKg:0}});s.setDraft('编辑中的下一步');await s.pickUp(tin);expect(cmds).toHaveLength(1);
 await vi.advanceTimersByTimeAsync(20);await pending;expect(s.read()).toMatchObject({canRetry:true,inventory:[],draft:'编辑中的下一步'});
 const failed=s.read();late.resolve(stored);await vi.advanceTimersByTimeAsync(1);expect(s.read()).toBe(failed);
 await s.retry();expect(cmds[1]).toBe(cmds[0]);expect(s.read()).toMatchObject({phase:'success',inventory:[{count:1}],draft:'编辑中的下一步',playerStatus:{carryWeightKg:.05},clock:{worldRevision:2}});expect(s.read().entries).toHaveLength(1);
});
test('stale replies retain inventory/weight/targets; current missing or malformed inventory becomes null, then recovers',async()=>{
 const game=createGame(world());let stored!:ActionReply;let n=0;
 const s=make({dispatch:async c=>{n++;if(n===2&&stored.ok)return {...stored,clock:{...stored.clock,worldRevision:1,gameClockMinutes:1},inventory:[],pickupTargets:[{targetId:tin,label:'空罐'}],playerStatus:{...stored.playerStatus!,carryWeightKg:0}};
  const r=await game.dispatch(c);if(n===1)stored=r;if(n===3&&r.ok){const {inventory:_removed,...legacy}=r;return legacy;}if(n===4&&r.ok)return{...r,inventory:[{itemId:tin,label:'secret',count:1,weightKg:.05}] as any};return r;}});
 await s.pickUp(tin);const confirmed=s.read();await s.observe();expect(s.read()).toMatchObject({inventory:confirmed.inventory,playerStatus:confirmed.playerStatus,pickupTargets:[],clock:confirmed.clock});
 await s.observe();expect(s.read().inventory).toBeNull();await s.observe();expect(s.read().inventory).toBeNull();await s.observe();expect(s.read().inventory).toEqual(confirmed.inventory);
});
test('rule failure keeps confirmed values; legacy has null; invalid proposals do not dispatch',async()=>{
 const dispatch=vi.fn(async()=>({ok:false as const,code:'invalid_target'}));const s=make({dispatch}),initial=s.read();await s.pickUp(tin);
 expect(s.read()).toMatchObject({phase:'error',inventory:initial.inventory,pickupTargets:initial.pickupTargets,canRetry:false});
 const old=createObservationSession({client:{dispatch},interpreter:localIntentInterpreter,actorId:'prototype-player',initialClock:initial.clock});expect(old.read().inventory).toBeNull();expect(old.read().pickupTargets).toEqual([]);
 const invalid=make({dispatch},async()=>({ok:true,value:{verb:'pick_up',targetId:'hidden'}}));invalid.setDraft('拾取隐藏');await invalid.submitText();expect(dispatch).toHaveBeenCalledTimes(1);
 for(const targets of [[],[{targetId:'a',label:'空罐'},{targetId:'b',label:'空罐'}]])expect(await localIntentInterpreter.interpret({utterance:'拾取空罐',view:{summary:'',facts:[]},pickupTargets:targets},{timeoutMs:20})).toMatchObject({ok:false});
});
