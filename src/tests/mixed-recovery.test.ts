import {expect,it} from 'vitest';
import {readFileSync,readdirSync} from 'node:fs';
import {prepareMixedRecovery} from '../adapters/storage/mixed-recovery';
import {encodeSave,canonicalJSON,digest} from '../adapters/storage/save-format';
import {encodeSaveVersioned,decodeSaveVersioned} from '../adapters/storage/save-versions';
import {createEngine} from '../core/engine';
import {createContactPrototype} from '../core/contact-prototype';
import {readActionReceipts,type ActionReceipt} from '../core/receipts';
const meta={gameBuild:'mixed-test',savedAtUtc:'2026-10-26T00:00:00.000Z'},raw=readFileSync('src/tests/save-fixtures/v1.json','utf8');
async function current(){const e=createEngine(createContactPrototype());for(const verb of ['move','talk','talk']){const w=e.snapshot();expect(e.dispatch({commandId:'current-'+w.campaign.worldRevision,actorId:w.player.playerId,source:'text',verb,targetIds:['prototype-corridor'],toolIds:[],arguments:verb==='talk'?{topic:'greeting'}:{},utterance:'',expectedWorldRevision:w.campaign.worldRevision}).ok).toBe(true);}return encodeSaveVersioned(e.snapshot(),meta);}
const folders=['snapshots','transfer-snapshots','hidden-item-snapshots','lifecycle-snapshots','save-fixtures'];
const samples=folders.flatMap(folder=>readdirSync(`src/tests/${folder}`,{recursive:true}).filter(n=>String(n).endsWith('.json')).map(n=>`src/tests/${folder}/${n}`));
function request(r:ActionReceipt){const q=r.request,door=r.rule.startsWith('door-observe');return{commandId:r.commandId,actorId:q.actorId,source:'button',verb:door?'observe':r.rule.startsWith('cabinet-search')?'search':r.rule.split('-v')[0],targetIds:['itemId'in q?q.itemId:'cabinetId'in q?q.cabinetId:'doorId'in q?q.doorId:'destinationId'in q?q.destinationId:q.locationId],toolIds:[],arguments:door?{through:'door_gap',careful:true}:{},utterance:'',expectedWorldRevision:q.expectedWorldRevision};}
it.each(samples)('%s restores only previous truth, preserves all fields, replays and next door RNG',async file=>{
 const source=JSON.parse(readFileSync(file,'utf8')),world=source.format?source.worldState:source,previous=source.format?readFileSync(file,'utf8'):await encodeSave(world,meta);
 const result=await prepareMixedRecovery(await current(),previous,meta),restored=result.candidate.document.worldState;
 expect(result.currentDocument!.worldState.relationships).toHaveLength(1);expect(restored.relationships).toEqual([]);expect(restored.npcMemories).toEqual([]);
 const {npcMemories,stateSchema,...rest}=restored;expect(stateSchema).toBe('g2-world-v2');expect({...rest,stateSchema:'g0-world-v1'}).toEqual(world);
 expect(result.previousDocument.worldState).toEqual(world);expect(result.candidate.sourceText).toBe(previous);expect(result.currentIssue).toBeNull();expect(Object.isFrozen(result)).toBe(true);
 const old=createEngine(world),next=createEngine(restored);for(const r of readActionReceipts(world)){const before=next.snapshot();expect(next.dispatch(request(r))).toMatchObject({ok:true,replayed:true,receipt:r});expect(next.snapshot()).toBe(before);}
 const door=world.eventJournal.find((e:any)=>e.type==='DoorGapInitialized');if(!door)return;
 for(const [verb,target] of [...(world.player.locationId===door.payload.roomId?[]:[['move',door.payload.roomId]]),['observe',door.payload.doorId]]){
  const w=old.snapshot(),cmd={commandId:'next-'+w.campaign.worldRevision,actorId:w.player.playerId,source:'button',verb,targetIds:[target],toolIds:[],arguments:verb==='observe'?{through:'door_gap',careful:true}:{},utterance:'',expectedWorldRevision:w.campaign.worldRevision};const a=old.dispatch(cmd),b=next.dispatch(cmd);expect(a.ok).toBe(true);expect(b.ok).toBe(true);if(a.ok&&b.ok)expect(b.receipt).toEqual(a.receipt);expect(next.snapshot().rngState).toEqual(old.snapshot().rngState);
 }
});
it.each(['checksum_mismatch','inconsistent_fields','invalid_world'] as const)('recognizes only strict recoverable v2 %s',async issue=>{
 const d=JSON.parse(await current());if(issue==='checksum_mismatch')d.checksums.state='0'.repeat(64);
 else{if(issue==='inconsistent_fields')d.worldRevision++;else d.worldState.relationships=[];const {checksums,...payload}=d;d.checksums={state:await digest(payload)};}
 const result=await prepareMixedRecovery(JSON.stringify(d),raw,meta);expect(result.currentDocument).toBeNull();expect(result.currentIssue).toBe(issue);expect(result.candidate.document.schemaVersion).toBe(2);
});
it.each(['bad-json','future','v1','missing-field','extra-field','wrong-internal'] as const)('refuses unsafe current %s even with good previous',async mode=>{
 const d=JSON.parse(await current());if(mode==='future')d.schemaVersion=99;if(mode==='missing-field')delete d.rngState;if(mode==='extra-field')d.extra=true;if(mode==='wrong-internal')d.worldState.stateSchema='g0-world-v1';
 await expect(prepareMixedRecovery(mode==='bad-json'?'{bad':mode==='v1'?raw:JSON.stringify(d),raw,meta)).rejects.toHaveProperty('code');
});
it.each(['bad-json','v2','future','bad-checksum'] as const)('refuses previous %s rather than inventing a mapping',async mode=>{
 const d=JSON.parse(raw);if(mode==='future')d.schemaVersion=99;if(mode==='bad-checksum')d.checksums.state='0'.repeat(64);
 await expect(prepareMixedRecovery(await current(),mode==='bad-json'?'{bad':mode==='v2'?await current():JSON.stringify(d),meta)).rejects.toHaveProperty('code');
});
it('same inputs and metadata have a deterministic candidate and do not splice later relations',async()=>{
 const now=await current(),a=await prepareMixedRecovery(now,raw,meta),b=await prepareMixedRecovery(now,raw,meta);expect(a).toEqual(b);
 expect(canonicalJSON((await decodeSaveVersioned(a.candidate.text)).worldState)).toBe(canonicalJSON(a.candidate.document.worldState));
});
