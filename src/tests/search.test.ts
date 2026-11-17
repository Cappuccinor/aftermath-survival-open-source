import { expect, it } from 'vitest';
import { createEngine } from '../core/engine';
import * as prototypes from '../core/prototype';
import { visibleInspectionTargets } from '../core/inspection';
const c = (n:number,verb='search',target='prototype-location') => ({commandId:`search-${n}`,actorId:'prototype-player',source:'button',utterance:'',verb,targetIds:[target],toolIds:[],arguments:{},expectedWorldRevision:n});
it('has a separate search prototype with a real undiscovered tin',()=>{
 expect(prototypes).toHaveProperty('createSearchPrototype');
});
it('discovers once atomically, preserves materials and first evidence on repeat',()=>{
 const make = (prototypes as unknown as {createSearchPrototype: typeof prototypes.createMovementPrototype}).createSearchPrototype;
 expect(make).toBeTypeOf('function'); if(!make)return;
 const e=createEngine(make()), initial=e.snapshot();
 expect(visibleInspectionTargets(initial)).toEqual([]); expect(Object.keys(initial.items)).toEqual(['prototype-tin']);
 expect(e.dispatch(c(0,'inspect','prototype-tin'))).toEqual({ok:false,code:'invalid_target'});
 expect(e.dispatch(c(0))).toMatchObject({ok:true,receipt:{rule:'search-v1',discoveredItemId:'prototype-tin'}});
 const first=e.snapshot().knowledge.find(k=>k.factId==='seen-item-prototype-tin');
 expect(e.dispatch(c(1))).toMatchObject({ok:true,receipt:{discoveredItemId:null}});
 expect(e.snapshot().knowledge.find(k=>k.factId==='seen-item-prototype-tin')).toEqual(first);
 expect(e.snapshot().items).toEqual(initial.items); expect(e.snapshot().rngState).toEqual(initial.rngState); expect(e.snapshot().player.stats).toEqual(initial.player.stats);
 expect(e.snapshot().campaign.gameClockMinutes).toBe(2); expect(e.snapshot().locations['prototype-location']!.searched).toBe(true);
 expect(visibleInspectionTargets(e.snapshot())).toEqual([{targetId:'prototype-tin',label:'空罐'}]);
});
import { createSearchPrototype, createMovementPrototype } from '../core/prototype';
import { MAX_CLOCK_MINUTES } from '../core/schema';
it('rebuilds 24 mixed actions, retries every old request across locations, and isolates worlds',()=>{
 let e=createEngine(createSearchPrototype()); const untouched=createEngine(createSearchPrototype()), initial=e.snapshot(), commands=[];
 for(let n=0;n<24;n++){
  const phase=n%6, verb=['search','inspect','move','observe','move','search'][phase]!;
  const target=phase===1?'prototype-tin':phase===2||phase===3?'prototype-corridor':'prototype-location';
  const command=c(n,verb,target); expect(e.dispatch(command)).toMatchObject({ok:true,replayed:false});commands.push(command);
  e=createEngine(JSON.parse(JSON.stringify(e.snapshot()))); const before=e.snapshot();
  for(const old of commands)expect(e.dispatch(old)).toMatchObject({ok:true,replayed:true});
  expect(e.snapshot()).toBe(before); expect(before.campaign.gameClockMinutes).toBe(n+1);
  expect(before.items).toEqual(initial.items);expect(before.rngState).toEqual(initial.rngState);expect(before.player.stats).toEqual(initial.player.stats);
 }
 expect(untouched.snapshot()).toEqual(initial);
});
it.each(['empty','multiple','missing','remote','dark','dead','actor','revision','tools','arguments'])('rejects %s search atomically',mode=>{
 const w=JSON.parse(JSON.stringify(createSearchPrototype())), command=c(0);
 if(mode==='empty')command.targetIds=[];if(mode==='multiple')command.targetIds.push('prototype-corridor');if(mode==='missing')command.targetIds=['missing'];
 if(mode==='remote')command.targetIds=['prototype-corridor'];if(mode==='dark')w.locations['prototype-location'].light=0;
 if(mode==='dead')w.player.stats.hp=0;if(mode==='actor')command.actorId='other';if(mode==='revision')command.expectedWorldRevision=9;
 if(mode==='tools')command.toolIds=['tool'] as never[];if(mode==='arguments')command.arguments={force:true};
 const e=createEngine(w),before=e.snapshot();expect(e.dispatch(command).ok).toBe(false);expect(e.snapshot()).toBe(before);
});
it.each(['time','revision','collision'])('preserves candidate on %s failure',mode=>{
 const w=JSON.parse(JSON.stringify(createSearchPrototype()));
 if(mode==='time')w.campaign.gameClockMinutes=MAX_CLOCK_MINUTES;if(mode==='revision')w.campaign.worldRevision=Number.MAX_SAFE_INTEGER;
 if(mode==='collision')w.eventJournal.push({...w.eventJournal[1],seq:3,type:'Reserved',eventId:'evt-search-0-discovery'});
 const e=createEngine(w),before=e.snapshot();expect(e.dispatch({...c(0),expectedWorldRevision:w.campaign.worldRevision})).toEqual({ok:false,code:'settlement_failed'});expect(e.snapshot()).toBe(before);
});
it.each(['version','result','item','source','time','searched','order','future','same-time-future'])('rejects damaged %s discovery history',mode=>{
 const e=createEngine(createSearchPrototype());expect(e.dispatch(c(0)).ok).toBe(true);expect(e.dispatch(c(1,'inspect','prototype-tin')).ok).toBe(true);
 const w=JSON.parse(JSON.stringify(e.snapshot()));const result=w.eventJournal.find((x:{type:string})=>x.type==='SearchRecorded'),discovery=w.eventJournal.find((x:{type:string})=>x.type==='ItemDiscovered');
 if(mode==='version')result.payload.rule='search-v2';if(mode==='result')result.payload.discoveredItemId=null;if(mode==='item')discovery.payload.itemId='other';
 if(mode==='source')w.knowledge.find((x:{factId:string})=>x.factId==='seen-item-prototype-tin').source='fake';
 if(mode==='time')discovery.payload.observedAt=0;if(mode==='searched')w.locations['prototype-location'].searched=false;
 if(mode==='order')w.eventJournal.reverse();
 if(mode==='future'||mode==='same-time-future'){
  const search=w.eventJournal.splice(2,3);w.eventJournal.push(...search);
  w.eventJournal.forEach((x:{seq:number;worldTimeMinutes:number},i:number)=>{x.seq=i+1;x.worldTimeMinutes=2;});
  // Intentionally try to prove earlier inspect with a later discovery, even equal timestamps.
  if(mode==='same-time-future')discovery.worldTimeMinutes=2;
 }
 expect(()=>createEngine(w)).toThrow();
});
it.each(['verb','target','revision'])('refuses search id conflicts in %s',mode=>{
 const e=createEngine(createSearchPrototype());expect(e.dispatch(c(0)).ok).toBe(true);const command=c(0);
 if(mode==='verb')command.verb='observe';if(mode==='target')command.targetIds=['prototype-corridor'];if(mode==='revision')command.expectedWorldRevision=1;
 const before=e.snapshot();expect(e.dispatch(command).ok).toBe(false);expect(e.snapshot()).toBe(before);expect(e.dispatch(c(0))).toMatchObject({ok:true,replayed:true});
});
it('preserves old searched without new scope; new scene requires history',()=>{
 const old=JSON.parse(JSON.stringify(createMovementPrototype()));old.locations['prototype-location'].searched=true;expect(()=>createEngine(old)).not.toThrow();
 const fresh=JSON.parse(JSON.stringify(createSearchPrototype()));fresh.locations['prototype-location'].searched=true;expect(()=>createEngine(fresh)).toThrow();
});
import {readFileSync} from 'node:fs';
it('accepts byte-preserved fixed baseline movement snapshot and retries/appends',()=>{
 const old=JSON.parse(readFileSync('src/tests/snapshots/g1-005-legacy-movement.json','utf8'));
 const provenance=JSON.parse(readFileSync('docs/evidence/g1-005/legacy-provenance.json','utf8'));
 const e=createEngine(old);expect(e.snapshot()).toEqual(old);
 for(const request of provenance.requests)expect(e.dispatch(request)).toMatchObject({ok:true,replayed:true});
 expect(e.dispatch(c(4,'inspect','prototype-tin')).ok).toBe(true);expect(()=>createEngine(JSON.parse(JSON.stringify(e.snapshot())))).not.toThrow();
});
import {canPerceiveInspectableItem} from '../core/inspection';
it('cannot use same-time later discovery as prior perception',()=>{
 const e=createEngine(createSearchPrototype());expect(e.dispatch(c(0)).ok).toBe(true);
 const w=e.snapshot(), discovery=w.eventJournal.find(x=>x.type==='ItemDiscovered')!;
 expect(canPerceiveInspectableItem(w,'prototype-tin',1,'prototype-location',discovery.seq)).toBe(false);
 expect(canPerceiveInspectableItem(w,'prototype-tin',1,'prototype-location',discovery.seq+1)).toBe(true);
 expect(canPerceiveInspectableItem(w,'prototype-tin',0,'prototype-location',discovery.seq+1)).toBe(false);
});
it('supports no-new-findings for valid baseline initial sight without overwriting it',()=>{
 const old=JSON.parse(JSON.stringify(createMovementPrototype())), search=createSearchPrototype().eventJournal.find(e=>e.type==='SearchScopeInitialized')!;
 old.eventJournal.push({...search,seq:old.eventJournal.length+1});const e=createEngine(old);
 expect(e.dispatch(c(0))).toMatchObject({ok:true,receipt:{discoveredItemId:null}});
 expect(e.snapshot().knowledge.find(k=>k.factId==='seen-item-prototype-tin')).toEqual(old.knowledge[0]);expect(()=>createEngine(JSON.parse(JSON.stringify(e.snapshot())))).not.toThrow();
});
