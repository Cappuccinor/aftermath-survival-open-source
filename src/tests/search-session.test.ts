import { expect,it } from 'vitest';
import { createSearchPrototype } from '../core/prototype';
import { createGame } from '../application/game';
import { createObservationSession } from '../application/session';
import { localIntentInterpreter } from '../adapters/ai/local-intent';
import { projectClock } from '../application/clock';
import { bootstrapNotice } from '../application/ports';
it.each(['搜索房间','搜查房间'])('accepts explicit %s and exposes only public results',async phrase=>{
 const world=createSearchPrototype(); const s=createObservationSession({client:createGame(world),interpreter:localIntentInterpreter,actorId:world.player.playerId,initialClock:projectClock(world),initialSearchTargets:[{targetId:'prototype-location',label:'房间'}]});
 expect(JSON.stringify(s.read())).not.toContain('空罐');expect(bootstrapNotice).not.toContain('空罐');
 s.setDraft(phrase);await s.submitText();expect(s.read()).toMatchObject({phase:'success',clock:{gameClockMinutes:1},inspectTargets:[{targetId:'prototype-tin',label:'空罐'}]});expect(s.read().entries.at(-1)?.summary).toContain('发现空罐');
 await s.search('prototype-location');expect(s.read().entries.at(-1)?.summary).toContain('没有新发现');
});
it.each(['不要搜索房间','我准备搜索房间','如果安全就搜索房间','搜索房间并拿走','搜索prototype-location','搜索秘密房间','把空罐数量设为10'])('refuses %s and preserves draft',async phrase=>{
 const world=createSearchPrototype(),s=createObservationSession({client:createGame(world),interpreter:localIntentInterpreter,actorId:world.player.playerId,initialClock:projectClock(world),initialSearchTargets:[{targetId:'prototype-location',label:'房间'}]});
 s.setDraft(phrase);await s.submitText();expect(s.read()).toMatchObject({phase:'error',draft:phrase,clock:{gameClockMinutes:0},inspectTargets:[]});
 s.setDraft('搜索房间');await s.submitText();expect(s.read().clock.gameClockMinutes).toBe(1);
});
it('rejects ambiguous labels',async()=>{
 expect(await localIntentInterpreter.interpret({utterance:'搜索房间',view:{summary:'',facts:[]},searchTargets:[{targetId:'a',label:'房间'},{targetId:'b',label:'房间'}]},{timeoutMs:100})).toEqual({ok:false,code:'invalid_output'});
});
import {createEngine} from '../core/engine';
import {visibleSearchTargets} from '../core/search';
import type {ActionReply,GameClient} from '../application/ports';
it('button and both texts produce identical complete worlds',async()=>{
 const worlds=[];
 for(const phrase of [null,'搜索房间','搜查房间']){
 const w=createSearchPrototype(),e=createEngine(w),game=createGame(w);
 const client:GameClient={async dispatch(input){const result=e.dispatch(input);expect(result.ok).toBe(true);return game.dispatch(input);}};
 const s=createObservationSession({client,interpreter:localIntentInterpreter,actorId:w.player.playerId,initialClock:projectClock(w),initialSearchTargets:visibleSearchTargets(w)});
 if(phrase){s.setDraft(phrase);await s.submitText();}else await s.search(w.player.locationId);worlds.push(e.snapshot());
 }
 expect(worlds[1]).toEqual(worlds[0]);expect(worlds[2]).toEqual(worlds[0]);
});
it('uncertain search commits once then same ID retry restores all projections',async()=>{
 const w=createSearchPrototype(),game=createGame(w);const commands:unknown[]=[];let first=true;
 const client:GameClient={async dispatch(input){commands.push(input);const reply=await game.dispatch(input);if(first){first=false;throw new Error('transport after commit');}return reply;}};
 const s=createObservationSession({client,interpreter:localIntentInterpreter,actorId:w.player.playerId,initialClock:projectClock(w),initialSearchTargets:visibleSearchTargets(w)});
 s.setDraft('搜索房间');await s.submitText();expect(s.read()).toMatchObject({phase:'error',canRetry:true,draft:'搜索房间',clock:{gameClockMinutes:0}});
 await s.search(w.player.locationId);expect(commands).toHaveLength(1);await s.retry();expect(commands[1]).toBe(commands[0]);expect(s.read()).toMatchObject({phase:'success',canRetry:false,clock:{gameClockMinutes:1},inspectTargets:[{label:'空罐'}]});expect(s.read().entries).toHaveLength(1);
});
it('late old reply cannot replace newer search targets or location',async()=>{
 const w=createSearchPrototype(),game=createGame(w);let old:ActionReply|undefined, calls=0;
 const client:GameClient={async dispatch(input){calls++;if(calls===3)return old!;const reply=await game.dispatch(input);if(calls===1)old=reply;return reply;}};
 const s=createObservationSession({client,interpreter:localIntentInterpreter,actorId:w.player.playerId,initialClock:projectClock(w),initialSearchTargets:visibleSearchTargets(w)});
 await s.search(w.player.locationId);await s.move('prototype-corridor');expect(s.read().searchTargets).toEqual([]);await s.observe();expect(s.read()).toMatchObject({clock:{gameClockMinutes:2},searchTargets:[],inspectTargets:[],currentLocation:{label:'走廊'}});
});
it('initial interpreter context has only public whitelist and no tin',async()=>{
 const w=createSearchPrototype();let seen:unknown;
 const s=createObservationSession({client:createGame(w),interpreter:{async interpret(input){seen=input;return {ok:false,code:'invalid_output'};}},actorId:w.player.playerId,initialClock:projectClock(w),initialSearchTargets:visibleSearchTargets(w)});
 s.setDraft('搜索房间');await s.submitText();expect(Object.keys(seen as object).sort()).toEqual(['routes','searchTargets','targets','utterance','view']);expect(JSON.stringify(seen)).not.toMatch(/空罐|prototype-tin|metadata|items|knowledge/);
});
