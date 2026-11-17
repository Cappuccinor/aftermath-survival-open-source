import { expect, test } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createEngine } from '../core/engine';
import { parseWorldState } from '../core/world';
import { createPickupPrototype, createPickupGame } from '../core/pickup-prototype';
import { doorCharacter, doorMetadata } from './door-fixtures';
import { action, clone, discovered, pickupCommand, room, tin } from './pickup-fixtures';

const scope=(w:any)=>w.eventJournal.find((e:any)=>e.type==='PickupScopeInitialized');
const transfer=(w:any)=>w.eventJournal.find((e:any)=>e.type==='ItemPickedUp');
const transferred=()=>{const e=discovered();if(!e.dispatch(pickupCommand()).ok)throw Error('pickup fixture failed');return clone(e.snapshot()) as any;};
const initialMutations:[string,(w:any)=>void][]=[
 ['scope missing',w=>{w.eventJournal=w.eventJournal.filter((e:any)=>e.type!=='PickupScopeInitialized');}],
 ['wrong scope type',w=>{scope(w).type='Other';}],['rule',w=>{scope(w).payload.rule='pickup-scope-v2';}],
 ['source',w=>{scope(w).payload.searchSourceEventId='missing';}],['actor',w=>{scope(w).actorId=null;}],
 ['time',w=>{scope(w).worldTimeMinutes=1;}],['visibility',w=>{scope(w).visibility='public';}],['target',w=>{scope(w).targetIds=[room];}],
 ['wrong player',w=>{scope(w).payload.playerId='other';}],['wrong location',w=>{scope(w).payload.locationId='prototype-corridor';}],
 ['initial count',w=>{scope(w).payload.initialItem.count=2;}],['initial weight',w=>{scope(w).payload.initialItem.weightKg=.1;}],
 ['initial carry',w=>{scope(w).payload.initialCarryWeightKg=.1;}],['current count',w=>{w.items[tin].count=2;}],
 ['current weight',w=>{w.items[tin].weightKg=.1;}],['current condition',w=>{w.items[tin].condition='changed';}],['metadata',w=>{w.items[tin].metadata.secret='changed';}],
 ['half position',w=>{w.items[tin].position={kind:'player',id:w.player.playerId};}],['half weight',w=>{w.player.stats.carryWeightKg=.05;}],
 ['container',w=>{w.items[tin].position={kind:'container',id:tin};}],
];
// Removing the entire optional scope from an untouched world is intentionally a legal old world.
test.each(initialMutations.filter(([name])=>name!=='scope missing'))('damaged initialization: %s',(_name,mutate)=>{
 const w:any=clone(createPickupPrototype());mutate(w);expect(()=>parseWorldState(w)).toThrow();expect(()=>createEngine(w)).toThrow();
});
test('scope cannot be appended after action',()=>{const w:any=clone(discovered().snapshot());const event=scope(w);w.eventJournal=w.eventJournal.filter((e:any)=>e!==event);w.eventJournal.push(event);w.eventJournal.forEach((e:any,n:number)=>e.seq=n+1);expect(()=>createEngine(w)).toThrow();});
const corruptions:[string,(w:any)=>void][]=[
 ['missing scope',w=>{w.eventJournal=w.eventJournal.filter((e:any)=>e.type!=='PickupScopeInitialized');}],
 ['missing transfer',w=>{w.eventJournal=w.eventJournal.filter((e:any)=>e.type!=='ItemPickedUp');}],
 ['half position',w=>{w.items[tin].position={kind:'location',id:room};}],['half weight',w=>{w.player.stats.carryWeightKg=0;}],
 ['wrong owner',w=>{w.items[tin].position.id='other';}],['weight duplicated',w=>{w.player.stats.carryWeightKg=.1;}],
 ['receipt count',w=>{transfer(w).payload.count=2;}],['receipt weight',w=>{transfer(w).payload.weightKg=.1;}],
 ['receipt before',w=>{transfer(w).payload.beforeCarryWeightKg=.05;}],['receipt after',w=>{transfer(w).payload.afterCarryWeightKg=.1;}],
 ['from',w=>{transfer(w).payload.from.id='prototype-corridor';}],['to',w=>{transfer(w).payload.to.id='other';}],
 ['location',w=>{transfer(w).payload.request.locationId='prototype-corridor';}],['request actor',w=>{transfer(w).payload.request.actorId='other';}],
 ['request target',w=>{transfer(w).payload.request.itemId=room;}],['request revision',w=>{transfer(w).payload.request.expectedWorldRevision=0;}],
 ['receipt time',w=>{transfer(w).payload.observedAt=1;}],['receipt revision',w=>{transfer(w).payload.committedRevision=1;}],
 ['receipt extra',w=>{transfer(w).payload.extra=true;}],['source',w=>{transfer(w).payload.perceptionSourceEventId='missing';}],
 ['event id',w=>{transfer(w).eventId='other';}],['event visibility',w=>{transfer(w).visibility='public';}],
 ['event actor',w=>{transfer(w).actorId=null;}],['event target',w=>{transfer(w).targetIds=[room];}],['event type',w=>{transfer(w).type='Other';}],
 ['duplicate',w=>{w.eventJournal.push({...clone(transfer(w)),eventId:'duplicate',seq:w.eventJournal.length+1});}],
 ['missing knowledge',w=>{w.knowledge=w.knowledge.filter((k:any)=>k.factId!==`pickup-${tin}`);w.player.knownFactIds=w.player.knownFactIds.filter((id:string)=>id!==`pickup-${tin}`);}],
 ['fact source',w=>{w.knowledge.find((k:any)=>k.factId===`pickup-${tin}`).source='evt-initial-search';}],
 ['fact time',w=>{w.knowledge.find((k:any)=>k.factId===`pickup-${tin}`).observedAt=1;}],
 ['fact confidence',w=>{w.knowledge.find((k:any)=>k.factId===`pickup-${tin}`).confidence=.5;}],
 ['no known fact',w=>{w.player.knownFactIds=w.player.knownFactIds.filter((id:string)=>id!==`pickup-${tin}`);}],
 ['no discovery',w=>{w.eventJournal=w.eventJournal.filter((e:any)=>e.type!=='ItemDiscovered');}],
 ['discovery after pickup',w=>{const d=w.eventJournal.find((e:any)=>e.type==='ItemDiscovered');w.eventJournal=w.eventJournal.filter((e:any)=>e!==d);w.eventJournal.push(d);}],
 ['unknown pickup event',w=>{w.eventJournal.push({eventId:'rogue',seq:w.eventJournal.length+1,type:'Other',worldTimeMinutes:2,actorId:null,targetIds:[],visibility:'private',payload:{rule:'pick_up-v2'}});}],
];
test.each(corruptions)('damaged/partial committed history: %s',(_name,mutate)=>{const w=transferred();mutate(w);w.eventJournal.forEach((e:any,n:number)=>e.seq=n+1);expect(()=>parseWorldState(w)).toThrow();expect(()=>createEngine(w)).toThrow();});
test('character pickup permits only proven carry weight, all other initial values remain exact',()=>{
 const e=createEngine(createPickupGame(doorCharacter,doorMetadata));expect(e.dispatch(action('search',0,room,doorMetadata.playerId)).ok).toBe(true);expect(e.dispatch(pickupCommand(1,'char',doorMetadata.playerId)).ok).toBe(true);
 for(const [key,value] of [['hp',99],['hunger',1],['carryWeightKg',.1]]){const w:any=clone(e.snapshot());w.player.stats[key!]=value;expect(()=>parseWorldState(w)).toThrow();}
});
test('old fixed snapshots remain readable, append old action and retry; baseline mixed source hash is fixed',()=>{
 const root='src/tests/snapshots';const files=readdirSync(root,{recursive:true}).filter(f=>String(f).endsWith('.json'));
 for(const f of files){const old=JSON.parse(readFileSync(`${root}/${f}`,'utf8'));const e=createEngine(old);const cmd=action('observe',old.campaign.worldRevision,undefined,old.player.playerId);expect(e.dispatch(cmd).ok).toBe(true);const current=e.snapshot();expect(e.dispatch(cmd)).toMatchObject({ok:true,replayed:true});expect(e.snapshot()).toBe(current);}
 const p=JSON.parse(readFileSync('docs/evidence/g1-009/legacy-provenance.json','utf8'));expect(createHash('sha256').update(readFileSync(p.file)).digest('hex')).toBe(p.sha256);
 const e=createEngine(JSON.parse(readFileSync(p.file,'utf8'))),before=e.snapshot();for(const cmd of p.requests){expect(e.dispatch(cmd)).toMatchObject({ok:true,replayed:true});expect(e.snapshot()).toBe(before);}
});
