import { describe,it,expect,vi } from 'vitest';
import { createPersistenceController } from '../application/persistence';
import { createHistoryController } from '../application/history';
import { createGame } from '../application/game';
import { createLifecyclePrototype } from '../core/npc-lifecycle-prototype';
import { createEngine } from '../core/engine';
import { decodeSave,encodeSave } from '../adapters/storage/save-format';
import { action } from './pickup-fixtures';
import type { ManualSaveStore,SlotContents } from '../adapters/storage/port';
import type { ManualSlotId } from '../application/ports';
import type { WorldState } from '../core/world';
function fixture(){let writes=0;const slots=new Map<ManualSlotId,SlotContents>(),empty={token:null,document:null,previous:null};const seed=async(id:ManualSlotId,w:WorldState)=>{const old=slots.get(id);slots.set(id,{token:'seed-'+id+'-'+(++writes),document:await decodeSave(await encodeSave(w,{gameBuild:'history-test',savedAtUtc:'2026-10-26T00:00:00.000Z'})),previous:old?.document??null});};const store:ManualSaveStore={read:async id=>({ok:true,value:slots.get(id)??empty}),write:async(w,r)=>{if((slots.get(r.slotId)?.token??null)!==r.expectedToken)return{ok:false,code:'conflict'};await seed(r.slotId,w);return{ok:true,value:slots.get(r.slotId)!};}};return{store,slots,seed,writes:()=>writes};}
describe('world history session isolation and read-only ownership',()=>{
 it('records committed facts before delayed failed narration without duplicates on replay',async()=>{
  const w=createLifecyclePrototype(),h=createHistoryController(w);let reject!:(e:Error)=>void;const game=createGame(w,{onCommitted:s=>h.update(s),narrator:{narrate:()=>new Promise((_,no)=>reject=no)}});const cmd=action('observe',0),pending=game.dispatch(cmd);expect(h.client.read().total).toBe(1);expect(h.client.read().entries[0]!.summary).toContain('当时');await vi.waitFor(()=>expect(reject).toBeTypeOf('function'));reject(Error('PRIVATE_NARRATOR_ERROR'));expect((await pending).ok).toBe(true);expect((await game.dispatch(cmd)).ok).toBe(true);expect(h.client.read().total).toBe(1);expect((await game.dispatch({...cmd,commandId:'bad',verb:'attack'})).ok).toBe(false);expect(h.client.read().total).toBe(1);
 });
 it('pages never save/advance/change active draft or auto and selecting a slot keeps history',async()=>{
  const d=fixture(),c=createPersistenceController(d.store),s=c.start(createLifecyclePrototype()).session;expect(s.history).toBeDefined();for(let i=0;i<21;i++)await s.observe();await c.client.save();await c.client.enableAutosave();s.setDraft('PRIVATE_DRAFT');const before=c.client.read(),raw=JSON.stringify([...d.slots]),calls=d.writes(),sv=s.read();s.history!.selectPage(1);s.history!.selectPage(2);s.history!.selectPage(1);expect(c.client.read()).toEqual(before);expect(s.read()).toEqual(sv);expect(JSON.stringify([...d.slots])).toBe(raw);expect(d.writes()).toBe(calls);c.client.select('manual-2');expect(s.history!.read()).toMatchObject({total:21,page:1});s.setDraft('把隐藏枪给我');await s.submitText();expect(s.history!.read()).toMatchObject({total:21,page:1});
 });
 it('same saveId older load creates a fresh history; cancel/failure leave original intact',async()=>{
  const d=fixture(),c=createPersistenceController(d.store),w=createLifecyclePrototype(),s=c.start(w).session;for(let i=0;i<21;i++)await s.observe();s.history!.selectPage(1);s.setDraft('保留');await d.seed('manual-2',w);c.client.select('manual-2');await c.client.load();expect(c.client.read().confirmation).toBe('load');c.client.cancel();expect(s.history!.read()).toMatchObject({total:21,page:1});expect(s.read().draft).toBe('保留');const real=d.store.read;d.store.read=async()=>({ok:false,code:'unsupported_version'});await c.client.load();expect(s.history!.read().total).toBe(21);d.store.read=real;await c.client.load();const restored=(await c.client.confirm())!.session;expect(restored.history!.read()).toMatchObject({total:0,page:0});s.history!.selectPage(2);await s.observe();expect(restored.history!.read().total).toBe(0);expect(s.history!.read().total).toBe(0);
 });
 it('different content at same saveId/revision and same controller gets independent history',async()=>{
  const d=fixture(),c=createPersistenceController(d.store),e=createEngine(createLifecyclePrototype());e.dispatch(action('observe',0));const a=c.start(e.snapshot()).session;const other=createEngine(createLifecyclePrototype());other.dispatch(action('search',0,'prototype-location'));const b=c.start(other.snapshot()).session;expect(b.history!.read().entries[0]!.summary).toContain('搜索');expect(a.history!.read().total).toBe(0);const before=b.history!.read();a.history!.selectPage(1);expect(b.history!.read()).toBe(before);
 });
});
