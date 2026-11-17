import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPersistenceController } from '../application/persistence';
import { createLifecyclePrototype } from '../core/npc-lifecycle-prototype';
import { createEngine } from '../core/engine';
import { readActionReceipts } from '../core/receipts';
import { decodeSave, encodeSave } from '../adapters/storage/save-format';
import type { ManualSaveStore, SlotContents, SaveResult } from '../adapters/storage/port';
import type { ManualSlotId } from '../application/ports';
const ids:ManualSlotId[]=['manual-1','manual-2','manual-3'];
const world=(id='world-a')=>{const w=createLifecyclePrototype(1);return createEngine({...w,campaign:{...w.campaign,saveId:id}}).snapshot();};
const empty=():SlotContents=>({token:null,document:null,previous:null});
function storage(){const slots=new Map<ManualSlotId,SlotContents>(),errors=new Map<ManualSlotId,string>();let calls=0;
 const port:ManualSaveStore={read:async id=>errors.has(id)?{ok:false,code:errors.get(id)!}:{ok:true,value:slots.get(id)??empty()},write:async(w,r)=>{calls++;const old=slots.get(r.slotId)??empty();if(old.token!==r.expectedToken)return{ok:false,code:'conflict'};if(r.signal?.aborted)return{ok:false,code:'cancelled'};const slot={token:'token-'+calls,document:await decodeSave(await encodeSave(w,{gameBuild:'test',savedAtUtc:'2026-10-24T00:00:00.000Z'})),previous:old.document};slots.set(r.slotId,slot);return{ok:true,value:slot};}};
 return{port,slots,errors,calls:()=>calls};
}
afterEach(()=>vi.useRealTimers());
describe('three manual slot application context',()=>{
 it('selects only a target, preserves world/draft and never marks an empty target saved',async()=>{
  const d=storage(),c=createPersistenceController(d.port),s=c.start(world()).session;await s.observe();await c.client.save();s.setDraft('还没决定');const before=s.read();
  c.client.select('manual-2');expect(s.read()).toEqual(before);expect(d.calls()).toBe(1);expect(c.client.read()).toMatchObject({selectedSlot:'manual-2',phase:'idle',savedToSelected:false});
  await c.client.refresh();expect(s.read()).toEqual(before);expect(c.client.read().slots.map(x=>x.status)).toEqual(['saved','empty','empty']);
  c.client.select('manual-1');expect(c.client.read().savedToSelected).toBe(true);expect(c.client.read().phase).toBe('saved');
 });
 it('copies the same complete world into empty slots without changing world IDs or RNG',async()=>{
  const d=storage(),c=createPersistenceController(d.port),s=c.start(world()).session;await s.observeDoorGap(s.read().doorTargets[0]!.targetId);
  for(const id of ids){c.client.select(id);await c.client.save();expect(c.client.read().phase).toBe('saved');}
  const docs=ids.map(id=>d.slots.get(id)!.document!);expect(docs[1]!.worldState).toEqual(docs[0]!.worldState);expect(docs[2]!.worldState).toEqual(docs[0]!.worldState);expect(new Set(docs.map(x=>x.saveId)).size).toBe(1);
  await s.observe();c.client.select('manual-2');await c.client.save();expect(d.slots.get('manual-1')!.document!.worldRevision).toBe(1);expect(d.slots.get('manual-2')!.document!.worldRevision).toBe(2);expect(d.slots.get('manual-3')!.document!.worldRevision).toBe(1);
 });
 it('rejects a higher revision stale branch after saving elsewhere, switching back and refreshing',async()=>{
  const d=storage(),seed=createPersistenceController(d.port);seed.start(world());await seed.client.save();const a=createPersistenceController(d.port),b=createPersistenceController(d.port);const sa=(await a.client.load())!.session,sb=(await b.client.load())!.session;
  await sa.search('prototype-location');await sa.pickUp(sa.read().pickupTargets[0]!.targetId);await a.client.save();const preserved=d.slots.get('manual-1');
  await sb.observe();await sb.observe();await sb.observe();b.client.select('manual-2');await b.client.save();b.client.select('manual-1');await b.client.refresh();expect(b.client.read().savedToSelected).toBe(false);await b.client.save();expect(b.client.read().phase).toBe('error');expect(d.slots.get('manual-1')).toEqual(preserved);
 });
 it('requires overwrite confirmation for any unbound occupied slot, labels and locks its target',async()=>{
  const d=storage(),c=createPersistenceController(d.port),s=c.start(world()).session;await c.client.save();c.client.select('manual-2');await c.client.save();const disk1=d.slots.get('manual-1');c.start(world('other'));s.setDraft('obsolete');
  await c.client.save();expect(c.client.read()).toMatchObject({confirmation:'save',confirmationLabel:'存档槽 2',selectedSlot:'manual-2'});c.client.select('manual-3');expect(c.client.read().selectedSlot).toBe('manual-2');await c.client.confirm();expect(d.slots.get('manual-2')!.document!.saveId).toBe('other');expect(d.slots.get('manual-1')).toEqual(disk1);
 });
 it('cancel overwrite preserves all slots and the current editable draft',async()=>{
  const d=storage(),c=createPersistenceController(d.port);c.start(world());c.client.select('manual-3');await c.client.save();const before=d.slots.get('manual-3'),s=c.start(world('other')).session;s.setDraft('保留');await c.client.save();s.setDraft('确认期间编辑');c.client.cancel();expect(s.read().draft).toBe('确认期间编辑');expect(d.slots.get('manual-3')).toEqual(before);await s.observe();expect(s.read().clock.worldRevision).toBe(1);
 });
 it('binds overwrite confirmation to its old token even if another page updates the same target',async()=>{
  const d=storage(),c=createPersistenceController(d.port);c.start(world());c.client.select('manual-2');await c.client.save();c.start(world('new'));await c.client.save();await d.port.write(world('external'),{slotId:'manual-2',expectedToken:d.slots.get('manual-2')!.token,allowReplaceWorld:true});await c.client.confirm();expect(c.client.read().phase).toBe('error');expect(d.slots.get('manual-2')!.document!.saveId).toBe('external');expect(d.slots.has('manual-1')).toBe(false);
 });
 it('restores three independent full worlds with correct next door RNG and original receipts',async()=>{
  const d=storage(),c=createPersistenceController(d.port);for(let i=0;i<ids.length;i++){const s=c.start(world('world-'+i)).session;for(let n=0;n<=i;n++)await s.observe();c.client.select(ids[i]!);await c.client.save();}
  const next=createPersistenceController(d.port);for(const id of ids){next.client.select(id);const original=d.slots.get(id)!.document!.worldState,started=await next.client.load();expect(started).not.toBeNull();expect(started!.session.read().clock.worldRevision).toBe(original.campaign.worldRevision);const replay=createEngine(original);for(const receipt of readActionReceipts(original)){if(receipt.rule!=='observe-v1')throw Error('unexpected test receipt');expect(replay.dispatch({commandId:receipt.commandId,actorId:receipt.request.actorId,source:'button',verb:'observe',targetIds:[receipt.request.locationId],toolIds:[],arguments:{},utterance:'',expectedWorldRevision:receipt.request.expectedWorldRevision})).toMatchObject({ok:true,replayed:true});}expect(replay.snapshot()).toEqual(original);const door=started!.session.read().doorTargets[0]!.targetId;await started!.session.observeDoorGap(door);await next.client.save();const after=d.slots.get(id)!.document!.worldState;const payload=after.eventJournal.slice(original.eventJournal.length).find(e=>'commandId'in e.payload)!.payload as {commandId:string};const e=createEngine(original);e.dispatch({commandId:payload.commandId,actorId:original.player.playerId,source:'button',verb:'observe',targetIds:[door],toolIds:[],arguments:{through:'door_gap',careful:true},utterance:'',expectedWorldRevision:original.campaign.worldRevision});expect(after).toEqual(e.snapshot());}
 });
 it('load confirmation captures an older snapshot and keeps its token protection after install',async()=>{
  const d=storage(),seed=createPersistenceController(d.port);seed.start(world());await seed.client.save();const c=createPersistenceController(d.port),current=c.start(world('unsaved')).session;current.setDraft('丢弃须确认');await c.client.load();expect(c.client.read().confirmationLabel).toBe('存档槽 1');const ext=createPersistenceController(d.port);const other=(await ext.client.load())!.session;await other.observe();await ext.client.save();const loaded=await c.client.confirm();expect(loaded!.session.read().clock.worldRevision).toBe(0);await loaded!.session.observe();await loaded!.session.observe();await c.client.save();expect(c.client.read().phase).toBe('error');expect(d.slots.get('manual-1')!.document!.worldRevision).toBe(1);
 });
 it('refresh discovers external first save without reloading or changing the unsaved session',async()=>{
  const d=storage(),c=createPersistenceController(d.port),s=c.start(world()).session;await c.client.refresh();expect(c.client.read().canLoad).toBe(false);await s.observe();s.setDraft('仍是我');const before=s.read();const other=createPersistenceController(d.port);other.start(world('external'));await other.client.save();await c.client.refresh();expect(c.client.read().canLoad).toBe(true);expect(c.client.read().slots[0]!.status).toBe('saved');expect(s.read()).toEqual(before);expect(c.client.read().savedToSelected).toBe(false);
 });
 it('lists one corrupt/future slot independently and permits another slot load/save',async()=>{
  const d=storage(),c=createPersistenceController(d.port);c.start(world());await c.client.save();d.errors.set('manual-2','unsupported_version');await c.client.refresh();expect(c.client.read().slots.map(s=>s.status)).toEqual(['saved','error','empty']);c.client.select('manual-2');await c.client.load();expect(c.client.read().phase).toBe('error');c.client.select('manual-3');await c.client.save();expect(c.client.read().phase).toBe('saved');expect(d.slots.get('manual-1')!.document!.saveId).toBe('world-a');
 });
 it('locks selection/start/actions/duplicates during a pending save and allows draft edits',async()=>{
  const d=storage();let finish!:(x:SaveResult<SlotContents>)=>void,requested:ManualSlotId|undefined;d.port.read=id=>{requested=id;return new Promise(r=>finish=r);};const c=createPersistenceController(d.port),s=c.start(world()).session;c.client.select('manual-2');const save=c.client.save();c.client.select('manual-3');await c.client.refresh();await c.client.save();await s.observe();expect(()=>c.start(world('new'))).toThrow();s.setDraft('能写');expect(c.client.read().selectedSlot).toBe('manual-2');expect(requested).toBe('manual-2');expect(s.read().clock.worldRevision).toBe(0);finish({ok:true,value:empty()});await save;expect(d.slots.has('manual-2')).toBe(true);expect(d.slots.has('manual-3')).toBe(false);expect(s.read().draft).toBe('能写');
 });
 it('times out a write, then ignores its late success after selection and world change',async()=>{
  vi.useFakeTimers();const d=storage();let finish!:(x:SaveResult<SlotContents>)=>void,signal:AbortSignal|undefined;d.port.write=(_w,r)=>{signal=r.signal;return new Promise(resolve=>finish=resolve);};const c=createPersistenceController(d.port,{timeoutMs:30});c.start(world());c.client.select('manual-2');const pending=c.client.save();await vi.advanceTimersByTimeAsync(31);await pending;expect(signal!.aborted).toBe(true);c.client.select('manual-3');const s=c.start(world('new')).session;s.setDraft('新输入');finish({ok:true,value:empty()});await Promise.resolve();await Promise.resolve();expect(c.client.read()).toMatchObject({selectedSlot:'manual-3',phase:'idle',savedToSelected:false});expect(s.read().draft).toBe('新输入');
 });
 it('refresh timeout discards late results instead of updating a newly selected target',async()=>{
  vi.useFakeTimers();const d=storage();const resolvers:((x:SaveResult<SlotContents>)=>void)[]=[];d.port.read=()=>new Promise(r=>resolvers.push(r));const c=createPersistenceController(d.port,{timeoutMs:30});const s=c.start(world()).session;const refresh=c.client.refresh();await vi.advanceTimersByTimeAsync(31);await refresh;c.client.select('manual-3');s.setDraft('保留');for(const resolve of resolvers)resolve({ok:true,value:empty()});await Promise.resolve();await Promise.resolve();expect(c.client.read().selectedSlot).toBe('manual-3');expect(c.client.read().slots.every(s=>s.status==='unchecked')).toBe(true);expect(s.read().draft).toBe('保留');
 });
 it('invalid programmatic selection never falls back to another target',()=>{
  const d=storage(),c=createPersistenceController(d.port);c.start(world());c.client.select('manual-2');c.client.select(Object.create({slotId:'manual-1'}) as ManualSlotId);expect(c.client.read().selectedSlot).toBe('manual-2');expect(d.calls()).toBe(0);
 });
});
