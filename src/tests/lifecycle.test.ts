import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createEngine } from '../core/engine';
import { parseWorldState } from '../core/world';
import { addNpcLifecycle } from '../core/npc-lifecycle-prototype';
import { lifecycleEntries, deadLife, lifeInit, door, action, clone, sequence, tin, water, gun, room, corridor } from './lifecycle-fixtures';
const init = (w: any) => w.eventJournal.find((e: any) => e.eventId === lifeInit);
function candidate(status = 'dead'): any {
  const w: any = clone(lifecycleEntries[0][2]());
  w.npcs[0] = { ...w.npcs[0], kind: 'g1-static-witness-v2', life: status === 'dead' ? clone(deadLife) : { status: 'alive' } };
  w.eventJournal.push({ eventId: lifeInit, seq: w.eventJournal.length + 1, type: 'NpcLifecycleInitialized', actorId: w.player.playerId,
    targetIds: [w.npcs[0].npcId], visibility: 'private', worldTimeMinutes: 0,
    payload: { rule: 'npc-lifecycle-scope-v1', playerId: w.player.playerId, hiddenSourceEventId: 'evt-initial-npc-hidden-item', initialNpc: clone(w.npcs[0]) } });
  return w;
}
function oldDomain(input: unknown) { const w: any = clone(input); delete w.npcs[0].life; w.npcs[0].kind = 'g1-door-witness-v1'; w.eventJournal = w.eventJournal.filter((e: any) => e.eventId !== lifeInit).map((e: any, i: number) => ({ ...e, seq: i + 1 })); return w; }
test.each(lifecycleEntries)('%s true sourced initial lifecycle, gun ownership and no player knowledge or initialization costs', (_, factory, old) => {
  for (const status of ['alive', 'dead'] as const) {
    const w: any = factory(status); expect(w.npcs[0].kind).toBe('g1-static-witness-v2'); expect(w.npcs[0].life).toEqual(status === 'dead' ? deadLife : { status });
    expect(w.items[gun].position).toEqual({ kind: 'npc', id: w.npcs[0].npcId }); expect(oldDomain(w)).toEqual(old());
    expect(() => addNpcLifecycle(w)).toThrow(); expect(() => parseWorldState(candidate(status))).not.toThrow();
  }
});
test.each(lifecycleEntries.flatMap(([name,factory,old]) => (['alive','dead'] as const).flatMap(status => [tin,water].map(first => [name,status,first,factory,old] as const))))('%s %s %s 24 mixed actions, historical replay and old alive differential', (_, status, first, factory, old) => {
    let e = createEngine(factory(status)); const baseline = createEngine(old()), initial = e.snapshot(), requests: ReturnType<typeof action>[] = [], receipts: unknown[] = [];
    for (const [n,[verb,target]] of sequence(first).entries()) {
      const c = action(verb,n,target,initial.player.playerId), result = e.dispatch(c), expected = baseline.dispatch(c);
      expect(result.ok, `${status}/${first}/${n}`).toBe(true); if (!result.ok) throw Error('failed');
      if (status === 'alive') { expect(result.receipt).toEqual(expected.ok && expected.receipt); expect(oldDomain(e.snapshot())).toEqual(baseline.snapshot()); }
      if (status === 'dead' && target === door) expect(result.receipt).toMatchObject({ rule:'door-observe-v2', noticed:false,noticeRoll:null,noticeCapability:'absent' });
      const w: any = e.snapshot(); expect(w.npcs[0].life).toEqual(status === 'dead' ? deadLife : {status}); expect(w.items[gun]).toEqual(initial.items[gun]);
      if (status === 'dead') { expect(w.npcs[0].alertness).toBe(initial.npcs[0]!.alertness); expect(w.npcs[0].firstNoticed).toBeNull(); expect(w.eventJournal.some((x:any)=>['NPCAlertnessChanged','DoorReactionHeard'].includes(x.type))).toBe(false); }
      requests.push(c);receipts.push(result.receipt);e=createEngine(clone(w));expect(e.snapshot()).toEqual(w);const restored=e.snapshot();
      requests.forEach((request,i)=>{expect(e.dispatch(request)).toMatchObject({ok:true,replayed:true,receipt:receipts[i]});expect(e.snapshot()).toBe(restored);});
    }
    expect(e.snapshot().player.stats.carryWeightKg).toBe(.55);expect(e.snapshot().campaign.worldRevision).toBe(24);
    expect(()=>addNpcLifecycle(e.snapshot(),'dead')).toThrow();
});
test.each([[1,'shoes',270369],[35,'shoes',8938497],[1472,'shadow',397981212],[2944,'none',795962424],[2976,'none',804612186]] as const)('dead seed %s exact visual %s one draw %s', (seed,visual,state)=>{
  const e=createEngine(lifecycleEntries[0][1]('dead',seed)),before=e.snapshot();const r=e.dispatch(action('observe',0,door));
  expect(r).toMatchObject({ok:true,receipt:{rule:'door-observe-v2',visual,visualRoll:state/4294967296,noticeRoll:null,noticeCapability:'absent',noticed:false,rngAfter:{state}}});
  expect(e.snapshot().npcs).toEqual(before.npcs);expect(e.snapshot().eventJournal.slice(before.eventJournal.length).map(x=>x.type)).toEqual(['TimeAdvanced','DoorObservationRecorded']);
});
test('seed1 alive notice really changes NPC; dead visual still shoes without notice',()=>{
  const alive=createEngine(lifecycleEntries[0][1]()),dead=createEngine(lifecycleEntries[0][1]('dead'));
  expect(alive.dispatch(action('observe',0,door))).toMatchObject({ok:true,receipt:{noticed:true,visual:'shoes'}});
  expect(dead.dispatch(action('observe',0,door))).toMatchObject({ok:true,receipt:{noticed:false,visual:'shoes'}});
  expect(alive.snapshot().npcs[0]!.firstNoticed).not.toBeNull();expect(dead.snapshot().npcs[0]!.firstNoticed).toBeNull();
});
const mutations: [string,(w:any)=>void][]=[
 ['missing scope',w=>w.eventJournal.pop()],['missing NPC',w=>w.npcs=[]],['legacy shape with scope',w=>{delete w.npcs[0].life;w.npcs[0].kind='g1-door-witness-v1';}],
 ['silent resurrection',w=>w.npcs[0].life={status:'alive'}],['silent death',w=>{w.npcs[0].life={status:'alive'};init(w).payload.initialNpc.life=deadLife;}],
 ['unknown life',w=>w.npcs[0].life.status='undead'],['cause',w=>w.npcs[0].life.cause='battle'],['postgame death',w=>w.npcs[0].life.atGameMinutes=1],
 ['NPC location',w=>w.npcs[0].locationId=room],['changed alertness',w=>w.npcs[0].alertness+=10],['first notice',w=>w.npcs[0].firstNoticed={playerId:w.player.playerId,locationId:room,observedAt:0,sourceEventId:lifeInit}],
 ['wrong source',w=>init(w).payload.hiddenSourceEventId='evt-initial-transfer'],['unknown version',w=>init(w).payload.rule='npc-lifecycle-scope-v9'],
 ['wrong player',w=>init(w).payload.playerId='other'],['wrong actor',w=>init(w).actorId=null],['wrong target',w=>init(w).targetIds=[room]],['public',w=>init(w).visibility='public'],
 ['initial NPC ID',w=>init(w).payload.initialNpc.npcId='other'],['initial location',w=>init(w).payload.initialNpc.locationId=room],['forged initial alertness',w=>{w.npcs[0].alertness=10;init(w).payload.initialNpc.alertness=10;}],
 ['duplicate scope',w=>w.eventJournal.push({...clone(init(w)),eventId:'copy'})],['orphan ID',w=>{init(w).type='Other';init(w).payload={};}],
 ['before hidden source',w=>{const e=w.eventJournal.pop();w.eventJournal.splice(w.eventJournal.length-1,0,e);}],
 ['gun dropped',w=>w.items[gun].position={kind:'location',id:room}],
 ...['NPCMoved','NPCSpoke','NPCResurrected','NPCAlertnessChanged','DoorReactionHeard'].map(type=>[type,(w:any)=>w.eventJournal.push({eventId:'fake',seq:0,type,actorId:w.player.playerId,targetIds:[w.npcs[0].npcId],visibility:'private',worldTimeMinutes:0,payload:{rule:'fake-v1'}})] as [string,(w:any)=>void]),
 ['invented death knowledge',w=>{const factId='known-npc-death';w.player.knownFactIds.push(factId);w.knowledge.push({knowerId:w.player.playerId,factId,source:lifeInit,confidence:1,observedAt:0});}],
];
test.each(mutations)('rejects malformed lifecycle: %s',(_,mutate)=>{const w=candidate();mutate(w);w.eventJournal.forEach((e:any,i:number)=>e.seq=i+1);expect(()=>createEngine(w)).toThrow();});
test('rejects late lifecycle, stripped scope, imported live receipt, forged v2 roll and tampered observed history',()=>{
  const e=createEngine(lifecycleEntries[0][1]('dead'));expect(e.dispatch(action('observe',0,door)).ok).toBe(true);
  const acted:any=clone(e.snapshot());for(const mutate of [(w:any)=>{const i=w.eventJournal.findIndex((x:any)=>x.eventId===lifeInit);const [x]=w.eventJournal.splice(i,1);w.eventJournal.push(x);},(w:any)=>{w.npcs[0].life={status:'alive'};init(w).payload.initialNpc.life={status:'alive'};},(w:any)=>{w.eventJournal.at(-1).payload.noticeRoll=0;},(w:any)=>{w.eventJournal.at(-1).payload.visual='none';},(w:any)=>{w.eventJournal.at(-1).payload.rngAfter.state=1;},(w:any)=>{w.npcs[0].life=deadLife;w.eventJournal.at(-1).payload.rule='door-observe-v1';}]){
    const w=clone(acted);mutate(w);w.eventJournal.forEach((x:any,i:number)=>x.seq=i+1);expect(()=>createEngine(w)).toThrow();
  }
  const live=createEngine(lifecycleEntries[0][1]());live.dispatch(action('observe',0,door));const imported:any=clone(live.snapshot());imported.npcs[0].life=deadLife;init(imported).payload.initialNpc.life=deadLife;expect(()=>createEngine(imported)).toThrow();
});
test.each(['closed','dim','away','hp'])('dead keeps existing observation preconditions %s',mode=>{
 const w:any=clone(lifecycleEntries[0][1]('dead'));const d=w.eventJournal.find((e:any)=>e.eventId==='evt-initial-door-gap');
 if(mode==='closed')d.payload.gapOpen=false;if(mode==='dim'){d.payload.corridorLight=.1;w.locations[corridor].light=.1;}if(mode==='hp')w.player.stats.hp=0;
 const e=createEngine(w);let rev=0;if(mode==='away'){expect(e.dispatch(action('move',0,corridor)).ok).toBe(true);rev=1;}
 const before=e.snapshot();expect(e.dispatch(action('observe',rev,door)).ok).toBe(false);expect(e.snapshot()).toBe(before);
});
test('dead invalid actors/requests and command-ID conflicts cannot mutate; valid followup works',()=>{
 const e=createEngine(lifecycleEntries[0][1]('dead')), c=action('observe',0,door);
 for(const patch of [{actorId:'prototype-witness'},{verb:'talk'},{verb:'move',actorId:'prototype-witness',targetIds:[room]},{targetIds:[gun]},{arguments:{through:'door_gap',careful:true,revive:true}},{toolIds:[gun]},{expectedWorldRevision:1}]){const before=e.snapshot();expect(e.dispatch({...c,...patch}).ok).toBe(false);expect(e.snapshot()).toBe(before);}
 expect(e.dispatch(c).ok).toBe(true);const before=e.snapshot();expect(e.dispatch({...c,targetIds:[room]})).toEqual({ok:false,code:'command_id_conflict'});expect(e.snapshot()).toBe(before);expect(e.dispatch(action('search',1,room)).ok).toBe(true);
});
test('actual old G16 snapshot stays byte-fixed with original retries and further live action',()=>{
 const p=JSON.parse(readFileSync('docs/evidence/g1-017/legacy-provenance.json','utf8')),bytes=readFileSync(p.file),w=JSON.parse(bytes.toString());expect(createHash('sha256').update(bytes).digest('hex')).toBe(p.sha256);
 const e=createEngine(w);expect(e.snapshot()).toEqual(w);for(const c of p.requests)expect(e.dispatch(c)).toMatchObject({ok:true,replayed:true});expect(e.snapshot()).toEqual(w);
 expect(e.dispatch(action('observe',w.campaign.worldRevision,door,w.player.playerId))).toMatchObject({ok:true,receipt:{rule:'door-observe-v1'}});
});
test('source-recorded initial and acted dead samples rebuild, replay and continue without resurrection',()=>{
 const p=JSON.parse(readFileSync('docs/evidence/g1-017/new-snapshot-provenance.json','utf8'));
 for(const sample of p.files){const bytes=readFileSync(sample.file);expect(createHash('sha256').update(bytes).digest('hex')).toBe(sample.sha256);
  const w=JSON.parse(bytes.toString()),e=createEngine(w);expect(e.snapshot()).toEqual(w);expect(w.npcs[0].life).toEqual(deadLife);
  for(const c of sample.requests)expect(e.dispatch(c)).toMatchObject({ok:true,replayed:true});expect(e.snapshot()).toEqual(w);
  expect(e.dispatch(action('observe',w.campaign.worldRevision,door,w.player.playerId))).toMatchObject({ok:true,receipt:{rule:'door-observe-v2',noticed:false,noticeRoll:null}});
 }
});
