import { createIndexedDbStorage } from '../../adapters/storage/indexed-db';
import { encodeSave, decodeSave } from '../../adapters/storage/save-format';
import { createEngine } from '../../core/engine';
import initial from '../lifecycle-snapshots/initial-dead.json';
import type { ManualSaveStore, SaveResult, SlotContents } from '../../adapters/storage/port';
import type { ManualSlotId } from '../../application/ports';
import { runStorageChecks } from './storage-harness';
const slots: ManualSlotId[] = ['manual-1', 'manual-2', 'manual-3'];
function check(x: unknown, label: string): asserts x { if (!x) throw Error(label); }
function value<T>(r: SaveResult<T>): T { if (!r.ok) throw Error(r.code); return r.value; }
const a = createEngine(initial).snapshot();
const world = (id: string) => createEngine({ ...a, campaign: { ...a.campaign, saveId: id } }).snapshot();
function advance(input = a) { const e = createEngine(input); check(e.dispatch({ commandId: `cmd-multi-${input.campaign.worldRevision}`, actorId: input.player.playerId, source: 'button', verb: 'observe', targetIds: [], toolIds: [], arguments: {}, utterance: '', expectedWorldRevision: input.campaign.worldRevision }).ok, 'advance'); return e.snapshot(); }
const req = (slotId: ManualSlotId, expectedToken: string | null) => ({ slotId, expectedToken, allowReplaceWorld: false });
function open(name: string) { return new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open(name, 1); r.onupgradeneeded = () => { r.result.createObjectStore('heads'); r.result.createObjectStore('snapshots'); }; r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }
async function edit(name: string, f: (tx: IDBTransaction) => void) { const db = await open(name); try { await new Promise<void>((resolve, reject) => { const tx = db.transaction(['heads', 'snapshots'], 'readwrite'); f(tx); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); } finally { db.close(); } }
async function raw(name: string) { const db = await open(name); try { return await new Promise<string>((resolve, reject) => { const tx = db.transaction(['heads', 'snapshots']); const requests = ['heads', 'snapshots'].flatMap(s => [tx.objectStore(s).getAllKeys(), tx.objectStore(s).getAll()]); tx.oncomplete = () => resolve(JSON.stringify(requests.map(r => r.result))); tx.onabort = () => reject(tx.error); }); } finally { db.close(); } }
export async function runMultiStorageChecks(prefix: string) {
 const checks: string[] = [], name = prefix+'-multi', store = createIndexedDbStorage({ databaseName: name });
 const encodedA = await encodeSave(a, { gameBuild: 'g2-001', savedAtUtc: '2026-10-24T00:00:00.000Z' });
 const advanced = advance(a), encodedB = await encodeSave(advanced, { gameBuild: 'g2-001', savedAtUtc: '2026-10-24T00:01:00.000Z' });
 await edit(name, tx => { tx.objectStore('snapshots').put(encodedA,'legacy-a'); tx.objectStore('snapshots').put(encodedB,'legacy-b'); tx.objectStore('heads').put({ token:'legacy-b',previousToken:'legacy-a' },'manual-1'); });
 const oldBytes = await raw(name);
 check(value(await store.read('manual-1')).document?.worldRevision === 1,'legacy current');
 check(value(await store.read('manual-2')).document === null && value(await store.read('manual-3')).document === null,'new slots empty');
 check(await raw(name)===oldBytes,'read/new slots must not write legacy DB');
 for(const id of ['manual-2','manual-3'] as const) value(await store.write(world(id),req(id,null)));
 const legacy = value(await store.read('manual-1')); check(legacy.token==='legacy-b' && legacy.previous?.worldRevision===0,'legacy head/backup retained');
 const bytesAfterOthers = await raw(name); check(bytesAfterOthers.includes(encodedA.replaceAll('"','\\"')) && bytesAfterOthers.includes(encodedB.replaceAll('"','\\"')),'legacy snapshot bytes retained');
 checks.push('legacy version1 manual-1/current/backup exact; slots2/3 independent and read does not write');
 for(const invalid of [undefined, null, '', 'manual-4', new String('manual-1'), Object.create({slotId:'manual-1'})]) {
  const r=await store.read(invalid as ManualSlotId); check(!r.ok&&r.code==='invalid_slot','invalid read slot rejected');
  const w=await store.write(a,{...req(invalid as ManualSlotId,null)});check(!w.ok&&w.code==='invalid_slot','invalid write slot rejected');
 }
 let getterCalled=false; const inherited=Object.assign(Object.create({slotId:'manual-1'}),{expectedToken:'legacy-b',allowReplaceWorld:true});
 check(!(await store.write(a,inherited)).ok,'inherited write slot rejected');
 const getter=Object.defineProperty({expectedToken:'legacy-b',allowReplaceWorld:true},'slotId',{get(){getterCalled=true;return 'manual-1';}});
 check(!(await store.write(a,getter as Parameters<ManualSaveStore['write']>[1])).ok&&!getterCalled,'slot accessor not invoked');check(await raw(name)===bytesAfterOthers,'invalid inputs never write');
 checks.push('invalid/unknown/missing/boxed/inherited/accessor slot identity rejected without fallback or writes');
 const slot2=value(await store.read('manual-2')), before=await raw(name);
 for(const fault of ['abort','quota','cancel']) {
  const cancel=new AbortController(),old=IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put=function(...args:Parameters<IDBObjectStore['put']>){if(this.name==='heads'&&fault==='quota')throw new DOMException('injected','QuotaExceededError'); const r=old.apply(this,args);if(this.name==='snapshots')r.addEventListener('success',()=>{if(fault==='abort')this.transaction.abort();if(fault==='cancel')cancel.abort();},{once:true});return r;};
  try{check(!(await store.write(advance(slot2.document!.worldState),{...req('manual-2',slot2.token),signal:cancel.signal})).ok,'fault fails');}finally{IDBObjectStore.prototype.put=old;}
  check(await raw(name)===before,`${fault} keeps all slots and backups byte-identical`);
  check(value(await createIndexedDbStorage({databaseName:name}).read('manual-2')).token===slot2.token,'reopen slot2 old');
 }
 checks.push('slot2 snapshot-success abort/quota/cancel preserve all three slots and backups');
 // Same-world copies keep saveId but have independent histories/tokens.
 const copyName=prefix+'-copies',copies=createIndexedDbStorage({databaseName:copyName});
 const saved=await Promise.all(slots.map(async id=>value(await copies.write(a,req(id,null)))));
 for(let i=0;i<slots.length;i++){let w=a;for(let n=0;n<=i;n++)w=advance(w);value(await copies.write(w,req(slots[i]!,saved[i]!.token)));}
 const all=await Promise.all(slots.map(async id=>value(await copies.read(id))));check(all.every((x,i)=>x.document!.saveId===a.campaign.saveId&&x.document!.worldRevision===i+1&&x.previous!.worldRevision===0),'copy histories independent');
 checks.push('same saveId copied to three slots then revisions1/2/3 and previous0 independently');
 // Shared snapshot references must survive another slot's cleanup.
 const share=prefix+'-shared',ss=createIndexedDbStorage({databaseName:share}); const x=value(await ss.write(a,req('manual-1',null)));const y=value(await ss.write(advance(a),req('manual-1',x.token)));
 await edit(share,tx=>tx.objectStore('heads').put({token:x.token,previousToken:null},'manual-3'));
 value(await ss.write(advance(advance(a)),req('manual-1',y.token)));check(value(await ss.read('manual-3')).document?.worldRevision===0,'other slot reference not deleted');
 checks.push('backup pruning retains snapshots referenced by another slot');
 for(const broken of ['{broken', JSON.stringify({...JSON.parse(encodedA),schemaVersion:999})]){
  await edit(name,tx=>tx.objectStore('snapshots').put(broken,slot2.token!));const badBytes=await raw(name);
  const list=await Promise.all(slots.map(id=>store.read(id)));check(list[0]!.ok&&!list[1]!.ok&&list[2]!.ok,'bad slot isolated from list');
  check(!(await store.write(world('replacement'),{...req('manual-2',slot2.token),allowReplaceWorld:true})).ok,'bad slot cannot overwrite');check(await raw(name)===badBytes,'bad original unchanged');
  const good=value(list[2]!);value(await store.write(advance(good.document!.worldState),req('manual-3',good.token)));check(!((await store.read('manual-2')).ok),'good continues independently');
 }
 checks.push('corrupt/future slot2 leaves good slots readable/writable and bad bytes retained');
 checks.push(...await runStorageChecks(prefix+'-legacy-regression'));
 return checks;
}
let race:ManualSaveStore, slot:ManualSlotId, initialSlot:SlotContents;
export async function prepareRace(name:string,id:ManualSlotId){race=createIndexedDbStorage({databaseName:name});slot=id;initialSlot=value(await race.read(id));return initialSlot.token;}
export async function writeRace(){return race.write(a,req(slot,initialSlot.token));}
