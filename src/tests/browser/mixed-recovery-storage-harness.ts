import {createIndexedDbStorage} from '../../adapters/storage/indexed-db';
import {encodeSaveVersioned} from '../../adapters/storage/save-versions';
import {createContactPrototype} from '../../core/contact-prototype';
import {createEngine} from '../../core/engine';
import {rawDigest} from '../../adapters/storage/migration';
import type {SaveResult,MixedRecoveryTarget} from '../../adapters/storage/port';
import type {ManualSlotId} from '../../application/ports';
const slots=['manual-1','manual-2','manual-3'] as const;
function check(v:unknown,m:string):asserts v{if(!v)throw Error(m);}
const value=<T>(r:SaveResult<T>):T=>{if(!r.ok)throw Error(r.code);return r.value;};
export const recoveryRequest=(t:MixedRecoveryTarget,signal?:AbortSignal)=>({slotId:t.slotId,expectedToken:t.token,expectedPreviousToken:t.previousToken,expectedCurrentText:t.currentText,expectedPreviousText:t.previousText,candidateText:t.candidate.text,...(signal?{signal}:{})});
function open(name:string){return new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open(name,1);r.onupgradeneeded=()=>{r.result.createObjectStore('heads');r.result.createObjectStore('snapshots');};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function edit(name:string,f:(tx:IDBTransaction)=>void){const d=await open(name);try{await new Promise<void>((resolve,reject)=>{const t=d.transaction(['heads','snapshots'],'readwrite');f(t);t.oncomplete=()=>resolve();t.onabort=()=>reject(t.error);});}finally{d.close();}}
async function raw(name:string){const d=await open(name);try{return await new Promise<string>((resolve,reject)=>{const t=d.transaction(['heads','snapshots']),r=['heads','snapshots'].flatMap(s=>[t.objectStore(s).getAllKeys(),t.objectStore(s).getAll()]);t.oncomplete=()=>resolve(JSON.stringify(r.map(x=>x.result)));t.onabort=()=>reject(t.error);});}finally{d.close();}}
export async function seedMixedRace(name:string,previous:string){
 const engine=createEngine(createContactPrototype());for(const verb of ['move','talk','talk']){const w=engine.snapshot();check(engine.dispatch({commandId:'new-'+w.campaign.worldRevision,actorId:w.player.playerId,source:'text',verb,targetIds:['prototype-corridor'],toolIds:[],arguments:verb==='talk'?{topic:'greeting'}:{},utterance:'',expectedWorldRevision:w.campaign.worldRevision}).ok,'real later events');}
 const current=await encodeSaveVersioned(engine.snapshot(),{gameBuild:'native-g2-011',savedAtUtc:'2026-10-26T00:00:00.000Z'});
 await edit(name,t=>{for(const slot of slots){t.objectStore('heads').add({token:slot+'-current',previousToken:slot+'-previous'},slot);t.objectStore('snapshots').add(current,slot+'-current');t.objectStore('snapshots').add(previous,slot+'-previous');}t.objectStore('snapshots').add('unrelated','orphan');});return current;
}
function retained(before:string,after:string){const a=JSON.parse(before),b=JSON.parse(after);for(let i=0;i<a[2].length;i++)check(JSON.stringify(a[3][i])===JSON.stringify(b[3][b[2].indexOf(a[2][i])]),'old snapshot/orphan retained '+a[2][i]);}
export async function runMixedChecks(previous:string){
 const checks:string[]=[],name='g2-011-native';const current=await seedMixedRace(name,previous),s=createIndexedDbStorage({databaseName:name});
 for(const slot of slots){
  const before=await raw(name),t=value(await s.inspectConvertedPrevious!(slot));check(await raw(name)===before,'inspect zero writes');
  const restored=value(await s.restoreConvertedPrevious!(recoveryRequest(t)));check(restored.document?.schemaVersion===2,'restored v2');check(restored.document!.worldState.relationships.length===0,'source has no later relationships');check(restored.previous?.worldState.relationships.length===1,'previous retains later truth');retained(before,await raw(name));
  const a=JSON.parse(before),b=JSON.parse(await raw(name));for(const other of slots.filter(x=>x!==slot))check(JSON.stringify(a[1][a[0].indexOf(other)])===JSON.stringify(b[1][b[0].indexOf(other)]),'other full slot untouched');
  const pinned=value(await s.listMigrationOriginals!(slot)).filter(x=>x.source==='archive');check(pinned.length===2,'two permanent originals');for(const o of pinned)check([previous,current].includes(value(await s.exportMigrationOriginal!(slot,o.key)).text),'exact originals');
  const again=await s.restoreConvertedPrevious!(recoveryRequest(t));check(!again.ok&&again.code==='conflict','repeat confirmation no second commit');
  check(!(await s.inspectConvertedPrevious!(slot)).ok,'same version now requires ordinary confirmation');
  let saved=restored;for(let i=0;i<3;i++)saved=value(await s.write(restored.document!.worldState,{slotId:slot,expectedToken:saved.token,allowReplaceWorld:false}));
  for(const o of pinned)check([previous,current].includes(value(await s.exportMigrationOriginal!(slot,o.key)).text),'rotation preserves pinned bytes');
  const same=value(await s.inspectPrevious!(slot));value(await s.recoverPrevious!({slotId:slot,expectedToken:same.token,expectedPreviousToken:same.previousToken,expectedCurrentText:same.currentText,expectedPreviousText:same.previousText}));
 }
 checks.push('three full slots: readonly preview, exact source restoration, no later relations, both permanent originals, repeat conflict, rotation and ordinary same-version recovery');
 for(const mode of ['current-text','previous-text','current-token','previous-token','head-missing']){
  const n=name+'-cas-'+mode;await seedMixedRace(n,previous);const store=createIndexedDbStorage({databaseName:n}),t=value(await store.inspectConvertedPrevious!('manual-1'));
  await edit(n,tx=>{if(mode.endsWith('-text'))tx.objectStore('snapshots').put('changed',mode==='current-text'?t.token:t.previousToken);else if(mode==='head-missing')tx.objectStore('heads').delete('manual-1');else tx.objectStore('heads').put({token:mode==='current-token'?'changed':t.token,previousToken:mode==='previous-token'?'changed':t.previousToken},'manual-1');});
  const before=await raw(n),r=await store.restoreConvertedPrevious!(recoveryRequest(t));check(!r.ok&&r.code==='conflict','CAS '+mode);check(await raw(n)===before,'CAS zero writes');checks.push('CAS '+mode);
 }
 for(const which of ['current','previous']){
  const n=name+'-collision-'+which;await seedMixedRace(n,previous);const store=createIndexedDbStorage({databaseName:n}),t=value(await store.inspectConvertedPrevious!('manual-1'));
  const hash=await rawDigest(which==='current'?t.currentText:t.previousText);await edit(n,tx=>tx.objectStore('snapshots').add('wrong archive','migration-original:'+hash));
  const before=await raw(n),r=await store.restoreConvertedPrevious!(recoveryRequest(t));check(!r.ok&&r.code==='archive_conflict','archive collision '+which);check(await raw(n)===before,'archive collision atomic');checks.push('archive collision '+which);
 }
 for(const mode of ['missing','non-text','future','invalid'] as const){
  const n=name+'-previous-'+mode;await seedMixedRace(n,previous);await edit(n,tx=>mode==='missing'?tx.objectStore('snapshots').delete('manual-1-previous'):tx.objectStore('snapshots').put(mode==='non-text'?{}:mode==='future'?'{"format":"aftermath-save","schemaVersion":99}':'{bad','manual-1-previous'));
  const before=await raw(n),store=createIndexedDbStorage({databaseName:n});check(!(await store.inspectConvertedPrevious!('manual-1')).ok,'invalid previous refused');check(await raw(n)===before,'invalid previous zero writes');checks.push('previous '+mode);
 }
 for(const mode of ['checksum','future','relabelled','v1'] as const){
  const n=name+'-current-'+mode;await seedMixedRace(n,previous);const d=JSON.parse(current);if(mode==='checksum')d.checksums.state='0'.repeat(64);if(mode==='future')d.schemaVersion=99;if(mode==='relabelled')d.worldState.stateSchema='g0-world-v1';
  await edit(n,tx=>tx.objectStore('snapshots').put(mode==='v1'?previous:JSON.stringify(d),'manual-1-current'));const store=createIndexedDbStorage({databaseName:n}),before=await raw(n),t=await store.inspectConvertedPrevious!('manual-1');
  if(mode==='checksum'){const r=value(await store.restoreConvertedPrevious!(recoveryRequest(value(t))));check(r.backupWarning==='invalid_backup','bad current retained with warning');retained(before,await raw(n));}
  else{check(!t.ok,'unsafe current refused');check(await raw(n)===before,'unsafe current unchanged');}checks.push('current '+mode);
 }
 for(const mode of ['abort','quota','cancel','timeout','throw-quota'] as const){
  const n=name+'-fault-'+mode;await seedMixedRace(n,previous);const store=createIndexedDbStorage({databaseName:n,timeoutMs:mode==='timeout'?100:4000}),t=value(await store.inspectConvertedPrevious!('manual-1')),before=await raw(n),controller=new AbortController(),add=IDBObjectStore.prototype.add;let fired=false;
  IDBObjectStore.prototype.add=function(...args:Parameters<IDBObjectStore['add']>){
   if(mode==='throw-quota'&&this.transaction.db.name===n&&String(args[1]).startsWith('recovery-record:')){fired=true;throw new DOMException('injected synchronous quota','QuotaExceededError');}
   const r=add.apply(this,args);if(this.name==='snapshots'&&this.transaction.db.name===n&&!fired){fired=true;const tx=this.transaction;r.addEventListener('success',()=>{
    if(mode==='timeout'){const keep=()=>{try{const q=tx.objectStore('snapshots').get('keep');q.onsuccess=keep;}catch{}};keep();}
    else if(mode==='cancel')controller.abort();else if(mode!=='throw-quota'){tx.abort();if(mode==='quota')Object.defineProperty(tx,'error',{value:new DOMException('injected quota','QuotaExceededError')});}
   });}return r;
  };
  try{const r=await store.restoreConvertedPrevious!(recoveryRequest(t,controller.signal));check(!r.ok&&fired,'fault fired '+mode);check(await raw(n)===before,'no half archive/head '+mode);if(mode.includes('quota'))check(r.code==='quota_exceeded','quota classification '+mode);}
  finally{IDBObjectStore.prototype.add=add;}checks.push('actual transaction '+mode);
 }
 const unknown=name+'-unknown';await seedMixedRace(unknown,previous);const store=createIndexedDbStorage({databaseName:unknown,timeoutMs:100}),target=value(await store.inspectConvertedPrevious!('manual-1')),transaction=IDBDatabase.prototype.transaction;let late:(()=>void)|undefined;
 IDBDatabase.prototype.transaction=function(...args:Parameters<IDBDatabase['transaction']>){const tx=transaction.apply(this,args);if(this.name===unknown&&args[1]==='readwrite')Object.defineProperty(tx,'oncomplete',{set(handler){tx.addEventListener('complete',event=>{late=()=>handler.call(tx,event);});}});return tx;};
 try{const r=await store.restoreConvertedPrevious!(recoveryRequest(target));check(!r.ok&&r.code==='outcome_unknown','actual committed timeout unknown');check(value(await store.read('manual-1')).document!.worldState.relationships.length===0,'new complete source committed');const before=await raw(unknown);late?.();await Promise.resolve();check(await raw(unknown)===before,'late notification no rewrite');}finally{IDBDatabase.prototype.transaction=transaction;}
 checks.push('actual committed transaction with withheld completion: unknown, complete new head, late callback no rewrite');
 const pres=name+'-pre-cancel';await seedMixedRace(pres,previous);const p=createIndexedDbStorage({databaseName:pres}),t=value(await p.inspectConvertedPrevious!('manual-1')),before=await raw(pres),c=new AbortController();c.abort();check(!(await p.restoreConvertedPrevious!(recoveryRequest(t,c.signal))).ok,'pre-cancel');check(await raw(pres)===before,'pre-cancel no writes');checks.push('pre-cancel zero writes');
 return checks;
}
let race:{store:ReturnType<typeof createIndexedDbStorage>;target:MixedRecoveryTarget};
export async function prepareMixedRace(name:string,slot:ManualSlotId){const store=createIndexedDbStorage({databaseName:name});race={store,target:value(await store.inspectConvertedPrevious!(slot))};}
export async function commitMixedRace(){return race.store.restoreConvertedPrevious!(recoveryRequest(race.target));}
