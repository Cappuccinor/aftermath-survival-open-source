import {afterEach,expect,it,vi} from 'vitest';
import {createContactPrototype} from '../core/contact-prototype';
import {createLifecyclePrototype} from '../core/npc-lifecycle-prototype';
import {createPersistenceController} from '../application/persistence';
import {unavailableStorage} from '../adapters/storage/port';
import {createGame} from '../application/game';
import {createEngine} from '../core/engine';
import {projectReceiptOutcome} from '../application/receipt-outcome';
import {readActionReceipts} from '../core/receipts';
import {validateImportFile} from '../application/save-import';
import {encodeSaveVersioned} from '../adapters/storage/save-versions';
import {localIntentInterpreter} from '../adapters/ai/local-intent';
const store={...unavailableStorage,read:async()=>({ok:true as const,value:{token:null,document:null,previous:null}}),write:async()=>({ok:false as const,code:'unavailable'})};
afterEach(()=>vi.useRealTimers());
it.each([null,'打招呼','向近处打招呼','我打招呼。','请向近处打招呼','向周围打招呼','向近处的人打招呼'])('greeting button/text %s has the same safe effect',async phrase=>{
 const controller=createPersistenceController(store),session=controller.start(createContactPrototype()).session;
 expect(session.read().contactTarget).toEqual({targetId:'prototype-location',label:'近处'});
 await session.move('prototype-corridor');
 if(phrase===null)await session.greet!();else{session.setDraft(phrase);await session.submitText();}
 expect(session.read()).toMatchObject({phase:'success',clock:{gameClockMinutes:2},draft:''});
 expect(session.read().entries.at(-1)?.summary).toContain('我不认识你');
 expect(JSON.stringify(session.read())).not.toMatch(/hostility|alertness|npcMemories|prototype-witness|weapon|firearm|seed|Roll/);
 await session.greet!();expect(session.read().entries.at(-1)?.summary).toContain('我说过不要再叫');
 await session.greet!();expect(session.read().entries.at(-1)?.summary).toContain('没有听到回应');
 expect(session.history!.read().entries.map(x=>x.summary).slice(-3)).toEqual(session.read().entries.map(x=>'当时：'+x.summary));
});
it.each(['我准备打招呼','不要打招呼','打招呼然后攻击','让NPC敌意归零','向远处打招呼','打招呼？'])('ambiguous input %s does not execute',async phrase=>{
 const session=createPersistenceController(store).start(createContactPrototype()).session;session.setDraft(phrase);await session.submitText();
 expect(session.read()).toMatchObject({phase:'error',draft:phrase,clock:{worldRevision:0},entries:[]});
});
it('legacy v1 does not advertise or execute greeting',async()=>{
 const session=createPersistenceController(store).start(createLifecyclePrototype()).session;
 expect(session.read().contactTarget).toBeNull();session.setDraft('打招呼');await session.submitText();expect(session.read().clock.worldRevision).toBe(0);
});
it('current location updates greeting capability without revealing NPC location',async()=>{
 const session=createPersistenceController(store).start(createContactPrototype()).session;
 await session.move('prototype-corridor');expect(session.read().contactTarget?.targetId).toBe('prototype-corridor');
 await session.greet!();expect(session.read().entries.at(-1)?.summary).toContain('我不认识你');
 await session.move('prototype-location');await session.greet!();expect(session.read().entries.at(-1)?.summary).toContain('没有听到回应');
});
it('dead and absent response presentations are indistinguishable',async()=>{
 const dead=createPersistenceController(store).start(createContactPrototype(1,'dead')).session;
 const distant=createPersistenceController(store).start(createContactPrototype()).session;await dead.move('prototype-corridor');
 await dead.greet!();await distant.greet!();expect(dead.read().entries.at(-1)).toEqual(distant.read().entries.at(-1));
});
it('historical warning is projected from receipt and safe narrator sees only the audible outcome',async()=>{
 const initial=createContactPrototype(),moving=createEngine(initial);moving.dispatch({commandId:'arrive',actorId:initial.player.playerId,source:'text',verb:'move',targetIds:['prototype-corridor'],toolIds:[],arguments:{},utterance:'前往走廊',expectedWorldRevision:0});
 const w=moving.snapshot(),engine=createEngine(w),cmd={commandId:'talk-test',actorId:w.player.playerId,source:'text',verb:'talk',targetIds:['prototype-corridor'],toolIds:[],arguments:{topic:'greeting'},utterance:'打招呼',expectedWorldRevision:1};
 const first=engine.dispatch(cmd);expect(first.ok).toBe(true);engine.dispatch({...cmd,commandId:'talk-test2',expectedWorldRevision:2});
 const receipt=readActionReceipts(engine.snapshot())[1]!;expect(projectReceiptOutcome(engine.snapshot(),receipt).summary).toContain('我不认识你');
 const narrate=vi.fn(async()=>({ok:false as const,code:'provider_error' as const}));
 const game=createGame(w,{narrator:{narrate}});await game.dispatch(cmd);await game.dispatch(cmd);
 expect(narrate).toHaveBeenCalledTimes(1);expect(JSON.stringify(narrate.mock.calls)).not.toMatch(/hostility|npcMemories|prototype-witness|rng|warning_given/);
});
it('strict v2 UTF8 file import preserves complete contact world',async()=>{
 const world=createContactPrototype(),text=await encodeSaveVersioned(world,{gameBuild:'test',savedAtUtc:'2026-10-26T00:00:00.000Z'});
 const result=await validateImportFile(new Blob([text]),new AbortController().signal);expect(result.document.worldState).toEqual(world);expect(result.document.schemaVersion).toBe(2);
});
it('local interpreter only receives a current visible contact target, no hidden actor lookup',async()=>{
 const result=await localIntentInterpreter.interpret({utterance:'打招呼',view:{summary:'',facts:[]},contactTarget:{targetId:'room',label:'近处'}},{timeoutMs:100});
 expect(result).toEqual({ok:true,value:{verb:'talk',targetId:'room'}});
 expect((await localIntentInterpreter.interpret({utterance:'打招呼',view:{summary:'',facts:[]}},{timeoutMs:100})).ok).toBe(false);
});
it('high alertness response uses the historical branch, never the hidden value',async()=>{
 const engine=createEngine(createContactPrototype());for(let i=0;i<30&&engine.snapshot().npcs[0]!.alertness<50;i++)expect(engine.dispatch({commandId:'door'+i,actorId:engine.snapshot().player.playerId,source:'text',verb:'observe',targetIds:['prototype-door-gap'],toolIds:[],arguments:{through:'door_gap',careful:true},utterance:'观察门缝',expectedWorldRevision:i}).ok).toBe(true);
 expect(engine.snapshot().npcs[0]!.alertness).toBeGreaterThanOrEqual(50);
 const session=createPersistenceController(store).start(engine.snapshot()).session;await session.move('prototype-corridor');await session.greet!();expect(session.read().entries.at(-1)?.summary).toContain('别靠近。不要再喊。');expect(JSON.stringify(session.read())).not.toMatch(/alertness|hostility|npcMemories/);
});
it('committed greeting immediately withdraws saved before history; delayed narration does not trigger early autosave',async()=>{
 const initial=createEngine(createContactPrototype());expect(initial.dispatch({commandId:'arrive',actorId:initial.snapshot().player.playerId,source:'text',verb:'move',targetIds:['prototype-corridor'],toolIds:[],arguments:{},utterance:'前往走廊',expectedWorldRevision:0}).ok).toBe(true);
 const world=initial.snapshot();let saved:any={token:'old',document:await import('../adapters/storage/save-versions').then(async m=>m.decodeSaveVersioned(await m.encodeSaveVersioned(world,{gameBuild:'test',savedAtUtc:'2026-10-26T00:00:00.000Z'}))),previous:null};
 const write=vi.fn(async()=>({ok:true as const,value:saved}));let resolve!:(v:any)=>void;
 const c=createPersistenceController({read:async()=>({ok:true,value:saved}),write},{narrator:{narrate:()=>new Promise(r=>resolve=r)}}),s=(await c.client.load())!.session;
 await c.client.enableAutosave();let observed=false;s.history!.subscribe(h=>{if(h.total===2){observed=true;expect(c.client.read().savedToSelected).toBe(false);expect(c.client.read().phase).not.toBe('saved');}});
 const pending=s.greet!();expect(observed).toBe(true);expect(write).not.toHaveBeenCalled();await vi.waitFor(()=>expect(resolve).toBeTypeOf('function'));resolve({ok:false,code:'provider_error'});await pending;expect(write).toHaveBeenCalledTimes(1);expect(s.read().entries.at(-1)?.summary).toContain('我不认识你');
});
