import {expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {createPersistenceController} from '../application/persistence';
import {prepareV1Migration} from '../adapters/storage/migration';
import {prepareMixedRecovery} from '../adapters/storage/mixed-recovery';
import {encodeSaveVersioned,decodeSaveVersioned} from '../adapters/storage/save-versions';
import {createEngine} from '../core/engine';
import {createContactPrototype} from '../core/contact-prototype';
import type {ManualSaveStore,SlotContents,MixedRecoveryTarget,SaveResult} from '../adapters/storage/port';
import type {ManualSlotId} from '../application/ports';
const previous=readFileSync('src/tests/save-fixtures/v1.json','utf8'),meta={gameBuild:'flow-test',savedAtUtc:'2026-10-26T00:00:00.000Z'};
async function setup(timeoutMs=5000){
 const migrated=await prepareV1Migration(previous,meta),engine=createEngine(migrated.document.worldState);
 for(let i=0;i<2;i++){const w=engine.snapshot();expect(engine.dispatch({commandId:'after-old-'+i,actorId:w.player.playerId,source:'button',verb:'observe',targetIds:[],toolIds:[],arguments:{},utterance:'',expectedWorldRevision:w.campaign.worldRevision}).ok).toBe(true);}
 const current=await encodeSaveVersioned(engine.snapshot(),meta),converted=await prepareMixedRecovery(current,previous,meta);
 const target:MixedRecoveryTarget={slotId:'manual-1',token:'current',previousToken:'previous',currentText:current,previousText:previous,...converted};
 const heads=new Map<ManualSlotId,SlotContents>([['manual-1',{token:'current',document:converted.currentDocument,previous:converted.previousDocument}],['manual-2',{token:'other',document:converted.currentDocument,previous:converted.previousDocument}]]);
 const restored:SlotContents={token:'restored',document:converted.candidate.document,previous:converted.currentDocument},writes=vi.fn();
 const download={prepare:vi.fn(async()=>({start:vi.fn(),dispose:vi.fn()}))};
 const store:ManualSaveStore={read:async id=>({ok:true as const,value:heads.get(id)??{token:null,document:null,previous:null}}),write:async(world,q)=>{writes(q);if(q.expectedToken!==heads.get(q.slotId)?.token)return{ok:false as const,code:'conflict'};const value={token:'saved',document:await decodeSaveVersioned(await encodeSaveVersioned(world,meta)),previous:heads.get(q.slotId)!.document};heads.set(q.slotId,value);return{ok:true as const,value};},
  inspectPrevious:vi.fn(async()=>({ok:false as const,code:'cross_version_recovery_required'})),recoverPrevious:vi.fn(async()=>({ok:false as const,code:'wrong_path'})),
  inspectConvertedPrevious:vi.fn(async slotId=>({ok:true as const,value:{...target,slotId}})),restoreConvertedPrevious:vi.fn(async q=>{heads.set(q.slotId,restored);return{ok:true as const,value:restored};}),
  listMigrationOriginals:async()=>({ok:true as const,value:[{key:'private-archive',source:'archive',schemaVersion:1,worldRevision:migrated.document.worldRevision,changedArchive:false}]}),exportMigrationOriginal:async slotId=>({ok:true as const,value:{slotId,token:'private-archive',text:previous,kind:'valid',schemaVersion:1,worldRevision:migrated.document.worldRevision}})};
 store.readExisting=(id,signal)=>store.read(id,signal);const c=createPersistenceController(store,{timeoutMs,download});return{c,store,target,heads,restored,writes,download};
}
it('explicit conversion preview identifies old progress, retained originals, space and separate load; cancel writes nothing',async()=>{
 const d=await setup(),s=(await d.c.client.load())!.session;s.setDraft('保留草稿');const before=s.read(),disk=JSON.stringify([...d.heads]);
 await d.c.client.checkPrevious();expect(d.c.client.read().recovery).toMatchObject({phase:'confirm',conversion:'v1-to-v2',slotId:'manual-1'});
 const message=d.c.client.read().recovery.message;for(const word of ['v1','v2','后续','空间','永久','读取',d.target.previousDocument.savedAtUtc])expect(message).toContain(word);
 expect(JSON.stringify(d.c.client.read().recovery)).not.toMatch(/npcMemories|hostility|prototype-witness|private-archive|worldState|checksum/);
 d.c.client.cancelRecovery();await d.c.client.confirmRecovery();expect(d.store.restoreConvertedPrevious).not.toHaveBeenCalled();expect(s.read()).toEqual(before);expect(JSON.stringify([...d.heads])).toBe(disk);
});
it('confirmation submits once, revokes original selection/saved, preserves world history draft and auto, and requires explicit load',async()=>{
 const d=await setup(),s=(await d.c.client.load())!.session;await d.c.client.enableAutosave();await d.c.client.listOriginals!();s.setDraft('保留草稿');const before=s.read(),history=s.history!.read(),auto=d.c.client.read().autosave;
 await d.c.client.checkPrevious();await Promise.all([d.c.client.confirmRecovery(),d.c.client.confirmRecovery()]);
 expect(d.store.restoreConvertedPrevious).toHaveBeenCalledTimes(1);expect(d.store.recoverPrevious).not.toHaveBeenCalled();
 expect(d.store.restoreConvertedPrevious).toHaveBeenCalledWith(expect.objectContaining({slotId:'manual-1',expectedToken:'current',expectedPreviousToken:'previous',expectedCurrentText:d.target.currentText,expectedPreviousText:previous,candidateText:d.target.candidate.text}));
 expect(d.c.client.read().recovery.phase).toBe('recovered');expect(d.c.client.read().savedToSelected).toBe(false);expect(d.c.client.read().originals!.entries).toHaveLength(0);expect(d.c.client.read().originals!.message).toContain('重新列出');
 expect(s.read()).toEqual(before);expect(s.history!.read()).toEqual(history);expect(d.c.client.read().autosave).toEqual(auto);
 await d.c.client.refresh();await d.c.client.save();expect(d.writes).not.toHaveBeenCalled();expect(d.c.client.read().savedToSelected).toBe(false);
 await s.observe();expect(d.c.client.read().autosave.mode).toBe('paused');expect(d.writes).toHaveBeenCalledTimes(1);
 expect(d.writes).toHaveBeenCalledWith(expect.objectContaining({slotId:'manual-1',expectedToken:'current'}));expect(d.heads.get('manual-1')).toEqual(d.restored);
 expect(await d.c.client.load()).toBeNull();expect(d.c.client.read().confirmation).toBe('load');const loaded=await d.c.client.confirm();expect(loaded!.session.read().clock.worldRevision).toBe(d.target.previousDocument.worldRevision);
 expect(loaded!.session.history!.read().total).toBe(d.target.previousDocument.worldRevision);expect(d.c.client.read().autosave.mode).toBe('off');
});
it.each(['conflict','quota_exceeded','outcome_unknown','transaction_aborted','archive_conflict'] as const)('%s never grants a new binding or blind retry',async code=>{
 const d=await setup(),s=(await d.c.client.load())!.session;s.setDraft('保留');await d.c.client.listOriginals!();const before=s.read();d.store.restoreConvertedPrevious=vi.fn(async()=>({ok:false as const,code}));
 await d.c.client.checkPrevious();await d.c.client.confirmRecovery();expect(d.store.restoreConvertedPrevious).toHaveBeenCalledTimes(1);
 expect(d.c.client.read().recovery.phase).toBe(code==='outcome_unknown'?'unknown':'error');expect(d.c.client.read().busy).toBe(false);expect(s.read()).toEqual(before);
 if(code==='outcome_unknown'||code==='conflict'){expect(d.c.client.read().savedToSelected).toBe(false);expect(d.c.client.read().originals!.entries).toHaveLength(0);}
 await d.c.client.confirmRecovery();expect(d.store.restoreConvertedPrevious).toHaveBeenCalledTimes(1);
});
it.each(['cancel','slot','session'] as const)('late mixed inspection after %s cannot overwrite the new context',async boundary=>{
 const d=await setup();await d.c.client.load();let release!:(r:SaveResult<MixedRecoveryTarget>)=>void;d.store.inspectConvertedPrevious=()=>new Promise(r=>release=r);
 const pending=d.c.client.checkPrevious();await vi.waitFor(()=>expect(release).toBeTypeOf('function'));
 if(boundary==='slot')d.c.client.select('manual-2');else if(boundary==='session')d.c.start(createContactPrototype());else d.c.client.cancelRecovery();
 const view=d.c.client.read();release({ok:true as const,value:d.target});await pending;expect(d.c.client.read()).toEqual(view);await d.c.client.confirmRecovery();expect(d.store.restoreConvertedPrevious).not.toHaveBeenCalled();
});
it.each(['cancel','timeout'] as const)('in-flight mixed restore %s is unknown and its late result cannot adopt a new session',async mode=>{
 const d=await setup(mode==='timeout'?30:5000),s=(await d.c.client.load())!.session;s.setDraft('keep');await d.c.client.listOriginals!();let release!:(r:SaveResult<SlotContents>)=>void;d.store.restoreConvertedPrevious=()=>new Promise(r=>release=r);
 await d.c.client.checkPrevious();const pending=d.c.client.confirmRecovery();await vi.waitFor(()=>expect(release).toBeTypeOf('function'));if(mode==='cancel')d.c.client.cancelRecovery();await pending;
 expect(d.c.client.read().recovery.phase).toBe('unknown');expect(d.c.client.read().savedToSelected).toBe(false);expect(d.c.client.read().originals!.entries).toHaveLength(0);expect(s.read().draft).toBe('keep');
 d.c.start(createContactPrototype());const view=d.c.client.read();release({ok:true as const,value:d.restored});await Promise.resolve();await Promise.resolve();expect(d.c.client.read()).toEqual(view);
});
it('unsafe current never triggers conversion merely because a healthy previous exists',async()=>{
 const d=await setup();await d.c.client.load();d.store.inspectPrevious=async()=>({ok:false as const,code:'current_recovery_refused'});await d.c.client.checkPrevious();expect(d.c.client.read().recovery.phase).toBe('error');expect(d.store.inspectConvertedPrevious).not.toHaveBeenCalled();expect(d.store.restoreConvertedPrevious).not.toHaveBeenCalled();
});
it('unavailable dedicated adapter keeps ordinary cross-version recovery refused',async()=>{
 const d=await setup();delete d.store.inspectConvertedPrevious;delete d.store.restoreConvertedPrevious;await d.c.client.checkPrevious();expect(d.c.client.read().recovery.phase).toBe('error');expect(d.store.recoverPrevious).not.toHaveBeenCalled();
});
