import { afterEach, expect, test, vi } from 'vitest';
import * as core from '../core/engine';
import * as ui from '../ui/main';
import { createGame } from '../application/game';
import { createObservationSession } from '../application/session';
import { localIntentInterpreter } from '../adapters/ai/local-intent';
import { projectClock } from '../application/clock';
import { projectInventory } from '../application/inventory';
import { projectPlayerStatus } from '../application/player-status';
import { projectSceneContext } from '../application/scene-context';
import { projectLocation, visibleRoutes } from '../core/movement';
import { visibleSearchTargets } from '../core/search';
import { visibleInspectionTargets } from '../core/inspection';
import { visiblePickupTargets } from '../core/pickup';
import { visibleDoorTargets } from '../core/door-observation';
import type { WorldState } from '../core/world';
import type { ActionReply, GameClient } from '../application/ports';
import type { IntentInterpreter } from '../adapters/ai/ports';
import { gun, gunType, hiddenInit, hiddenEntries, sequence, action, cabinet, water, tin, room, corridor } from './hidden-item-fixtures';
import { lifecycleEntries, deadLife, lifeInit, door } from './lifecycle-fixtures';
function session(w: WorldState, client: GameClient = createGame(w), interpreter: IntentInterpreter = localIntentInterpreter) {
  return createObservationSession({ client, interpreter, actorId: w.player.playerId, initialClock: projectClock(w), initialSearchTargets: visibleSearchTargets(w),
    initialTargets: visibleInspectionTargets(w), initialPickupTargets: visiblePickupTargets(w), initialInventory: projectInventory(w), initialPlayerStatus: projectPlayerStatus(w),
    initialSceneContext: projectSceneContext(w), initialDoorTargets: visibleDoorTargets(w), initialLocation: projectLocation(w), initialRoutes: visibleRoutes(w), timeoutMs: 20 });
}
const original = core.createEngine, secret = /handgun|npc-hidden-item|npc-lifecycle|static-witness|noticeCapability|pre-game|concealed|枪|死亡|复活|尸体|prototype-witness/;
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function captureEngines() { const engines: ReturnType<typeof core.createEngine>[] = []; vi.spyOn(core, 'createEngine').mockImplementation(w => { const e = original(w); engines.push(e); return e; }); return engines; }
test('actual trusted bootstrap both public entries have explicit alive lifecycle and hidden NPC ownership', async()=>{
 const engines=captureEngines();vi.stubGlobal('document',{querySelector:()=>({})});const mount=vi.spyOn(ui,'mountObservationUI').mockImplementation(()=>()=>{});
 await import('../bootstrap');const call=mount.mock.calls[0]!,s=call[1]();
 expect(engines[0]!.snapshot().npcs[0]).toMatchObject({kind:'g1-static-witness-v2',life:{status:'alive'}});
 expect(JSON.stringify(s.read())).not.toMatch(secret);const creation=call[2]!,draft=creation.read().draft;
 creation.update({...draft,profile:{...draft.profile,name:'幸存者',importantItems:'我记得一把枪'}});creation.preview();const created=creation.start();
 expect(created).not.toBeNull();expect(engines[1]!.snapshot().npcs[0]).toMatchObject({kind:'g1-static-witness-v2',life:{status:'alive'}});
 expect(created!.character!.profile.importantItems).toBe('我记得一把枪');expect(JSON.stringify(created!.session.read())).not.toMatch(secret);
 for(const e of engines)expect(e.snapshot().items[gun]!.position).toEqual({kind:'npc',id:e.snapshot().npcs[0]!.npcId});
});
test.each(lifecycleEntries)('%s alive game/raw Narrator outputs remain equal legacy24 actions',async(_,factory,old)=>{
 const w=factory(),inputs:unknown[][]=[[],[]];expect(w.npcs[0]).toMatchObject({life:{status:'alive'}});
 const games=[w,old()].map((world,n)=>createGame(world,{narrator:{narrate:async(input,context)=>{inputs[n]!.push({input,timeoutMs:context.timeoutMs});return {ok:false,code:'not_implemented'};}}}));
 for(const [n,[verb,target]] of sequence().entries()){const c=action(verb,n,target,w.player.playerId);expect(await games[0]!.dispatch(c)).toEqual(await games[1]!.dispatch(c));}
 expect(inputs[0]).toEqual(inputs[1]);expect(JSON.stringify(inputs)).not.toMatch(secret);
});
test.each(lifecycleEntries)('%s real dead24 game results and raw Narrator parameters never show lifecycle or active reaction',async(_,factory)=>{
 const w=factory('dead'),engines=captureEngines(),inputs:unknown[]=[];expect(w.npcs[0]).toMatchObject({life:deadLife});expect(w.items[gun]!.position.id).toBe(w.npcs[0]!.npcId);
 const game=createGame(w,{narrator:{narrate:async(input)=>{inputs.push(input);return {ok:false,code:'not_implemented'};}}});
 for(const [n,[verb,target]] of sequence().entries()){const r=await game.dispatch(action(verb,n,target,w.player.playerId));expect(r.ok).toBe(true);if(!r.ok)throw Error('failed');
  expect(JSON.stringify([r,inputs])).not.toMatch(secret);if(target===door){expect(r.outcome.summary).toContain('透过门缝');expect(r.outcome.summary).not.toMatch(/轻响|察觉|说话|追/);if(n===0)expect(r.outcome.summary).toContain('旧鞋');}
 }
 expect(engines[0]!.snapshot().npcs).toEqual(w.npcs);expect(engines[0]!.snapshot().items[gun]).toEqual(w.items[gun]);expect(engines[0]!.snapshot().player.stats.carryWeightKg).toBe(.55);
});
test.each(lifecycleEntries)('%s real dead session raw interpreter inputs and authored guesses stay isolated; legal recovery works',async(_,factory)=>{
 const w=factory('dead'),engines=captureEngines(),inputs:any[]=[];const s=session(w,createGame(w),{interpret:async(input,context)=>{inputs.push(input);return localIntentInterpreter.interpret(input,context);}});
 for(const phrase of ['观察门缝','搜索房间','检查空罐','搜索柜子','拾取瓶装水','拾取空罐','前往走廊','前往房间','观察门缝']){s.setDraft(phrase);await s.submitText();expect(s.read().phase).toBe('success');expect(JSON.stringify(s.read())).not.toMatch(secret);}
 expect(JSON.stringify(inputs)).not.toMatch(secret);expect(engines[0]!.snapshot().npcs).toEqual(w.npcs);
 for(const phrase of ['他死了','复活他','我精准击杀他','他开口说话','抢他的手枪',`检查${w.npcs[0]!.npcId}`]){const before=engines[0]!.snapshot(),view=s.read();s.setDraft(phrase);await s.submitText();expect(s.read()).toMatchObject({phase:'error',draft:phrase,clock:view.clock,inventory:view.inventory});expect(engines[0]!.snapshot()).toBe(before);
  const {draft:_,...system}=s.read();expect(JSON.stringify(system)).not.toMatch(secret);const {utterance,...raw}=inputs.at(-1);expect(utterance).toBe(phrase);expect(JSON.stringify(raw)).not.toMatch(secret);
 }
 await s.observe();expect(s.read().phase).toBe('success');expect(engines[0]!.snapshot().npcs).toEqual(w.npcs);
});
test.each(['他开口向你说话。','他追上来了。','他已经察觉你。','他已复活。','他藏着枪。'])('dead Narrator false claim %s falls back after real commit and filtered input',async claim=>{
 const w=lifecycleEntries[0][1]('dead'),engines=captureEngines(),inputs:unknown[]=[];
 const safe=createGame(w),malicious=createGame(w,{narrator:{narrate:async(input,context)=>{inputs.push([input,context]);return {ok:true,value:claim};}}});
 const c=action('observe',0,door),a=await safe.dispatch(c),b=await malicious.dispatch(c);expect(b).toEqual(a);expect(b.ok&&b.outcome.summary).toContain('旧鞋');expect(JSON.stringify(inputs)).not.toMatch(secret);
 expect(engines[1]!.snapshot()).toEqual(engines[0]!.snapshot());expect(engines[1]!.snapshot().npcs).toEqual(w.npcs);
});
test.each(['inspect','search','pick_up'])('dead malicious %s hidden target candidate cannot allocate command or mutate',async verb=>{
 const w=lifecycleEntries[0][1]('dead'),engines=captureEngines(),game=createGame(w),dispatch=vi.fn(game.dispatch),s=session(w,{dispatch},{interpret:async()=>({ok:true,value:{verb,targetId:gun}}) as any});
 const before=engines[0]!.snapshot();s.setDraft('复活他');await s.submitText();expect(dispatch).not.toHaveBeenCalled();expect(engines[0]!.snapshot()).toBe(before);expect(s.read().draft).toBe('复活他');expect(s.read().message).not.toMatch(secret);
 await s.observeDoorGap(door);expect(s.read().clock.worldRevision).toBe(1);
});
test('real dead door timeout/late/sameID and alive other world preserve state and allow following actions',async()=>{
 vi.useFakeTimers();const w=lifecycleEntries[0][1]('dead'),engines=captureEngines(),game=createGame(w),commands:unknown[]=[];let resolve!:(r:ActionReply)=>void,stored!:ActionReply;
 const late=new Promise<ActionReply>(r=>resolve=r),s=session(w,{dispatch:async c=>{commands.push(c);stored=await game.dispatch(c);return commands.length===1?late:stored;}}),other=session(lifecycleEntries[1][1]());
 const pending=s.observeDoorGap(door);await vi.advanceTimersByTimeAsync(1);expect(s.read().phase).toBe('pending');s.setDraft('复活他');await s.search(room);expect(commands).toHaveLength(1);
 await vi.advanceTimersByTimeAsync(21);await pending;expect(s.read()).toMatchObject({canRetry:true,draft:'复活他',clock:{worldRevision:0}});const timed=s.read();resolve(stored);await vi.advanceTimersByTimeAsync(1);expect(s.read()).toBe(timed);
 await s.retry();expect(commands[1]).toBe(commands[0]);expect(s.read()).toMatchObject({phase:'success',draft:'复活他',clock:{worldRevision:1}});expect(s.read().entries).toHaveLength(1);expect(engines[0]!.snapshot().npcs).toEqual(w.npcs);
 await other.observeDoorGap(door);expect(engines[1]!.snapshot().npcs[0]!.firstNoticed).not.toBeNull();expect(engines[0]!.snapshot().npcs).toEqual(w.npcs);
 await s.search(cabinet);await s.pickUp(water);await s.move(corridor);expect(s.read().clock.worldRevision).toBe(4);expect(engines[0]!.snapshot().items[gun]).toEqual(w.items[gun]);expect(other.read().clock.worldRevision).toBe(1);
});
