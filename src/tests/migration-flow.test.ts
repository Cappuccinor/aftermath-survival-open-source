import {expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {createPersistenceController} from '../application/persistence';
import {createContactPrototype} from '../core/contact-prototype';
import {prepareV1Migration} from '../adapters/storage/migration';
import {decodeSaveVersioned,encodeSaveVersioned} from '../adapters/storage/save-versions';
import type {ManualSaveStore,MigrationTarget,SlotContents,SaveResult} from '../adapters/storage/port';
import type {ManualSlotId} from '../application/ports';
import {exportFile} from '../application/save-export';
import * as games from '../application/game';
const original=readFileSync('src/tests/save-fixtures/v1.json','utf8'),meta={gameBuild:'test',savedAtUtc:'2026-10-26T00:00:00.000Z'};
async function setup(timeoutMs=5000){
 const candidate=await prepareV1Migration(original,meta),heads=new Map<ManualSlotId,SlotContents>([['manual-1',{token:'old',document:candidate.sourceDocument,previous:null}]]);
 const writes=vi.fn(),commits=vi.fn(),download={prepare:vi.fn(async(_file:{filename:string;text:string},_signal:AbortSignal)=>({start:vi.fn(),dispose:vi.fn()}))};
 const store:ManualSaveStore={read:async id=>({ok:true,value:heads.get(id)??{token:null,document:null,previous:null}}),
 write:async(w,r)=>{writes();if(heads.get(r.slotId)?.token!==r.expectedToken)return{ok:false,code:'conflict'};return{ok:false,code:'not_expected'};},
 inspectMigration:async slotId=>({ok:true,value:{slotId,token:'old',previousToken:null,currentText:original,previousText:null,candidate}}),
 commitMigration:async r=>{commits(r);const value={token:'new',document:candidate.document,previous:candidate.sourceDocument};heads.set(r.slotId,value);return{ok:true,value};},
 listMigrationOriginals:async()=>({ok:true,value:[{key:'private-key',source:'current',schemaVersion:1,worldRevision:candidate.sourceDocument.worldRevision,changedArchive:false}]}),
 exportMigrationOriginal:async(slotId,key)=>({ok:true,value:{slotId,token:key,text:original,kind:'valid',worldRevision:candidate.sourceDocument.worldRevision,schemaVersion:1}})};
 store.readExisting=(id,s)=>store.read(id,s);
 const c=createPersistenceController(store,{timeoutMs,download});return{c,store,heads,candidate,commits,writes,download};
}
it('previews safely, explicit cancel writes nothing, no hidden state in DTO',async()=>{
 const d=await setup(),s=d.c.start(createContactPrototype()).session;s.setDraft('保留草稿');const before=s.read();
 await d.c.client.checkMigration!();expect(d.c.client.read().migration?.phase).toBe('confirm');
 expect(d.c.client.read().migration?.message).toMatch(/v1.*v2/);expect(d.c.client.read().migration?.message).toContain('空间');
 expect(JSON.stringify(d.c.client.read().migration)).not.toMatch(/worldState|private-key|checksum|prototype-witness|npcMemories|rngState/);
 d.c.client.cancelMigration!();await d.c.client.confirmMigration!();expect(d.commits).not.toHaveBeenCalled();expect(s.read()).toEqual(before);
});
it('confirm exactly once preserves current session/draft/auto and requires separate load',async()=>{
 const d=await setup(),s=(await d.c.client.load())!.session;await d.c.client.enableAutosave();s.setDraft('保留草稿');const before=s.read(),auto=d.c.client.read().autosave;
 await d.c.client.checkMigration!();await Promise.all([d.c.client.confirmMigration!(),d.c.client.confirmMigration!()]);
 expect(d.commits).toHaveBeenCalledTimes(1);expect(d.commits.mock.calls[0]![0]).toMatchObject({slotId:'manual-1',expectedToken:'old',expectedCurrentText:original,candidateText:d.candidate.text});
 expect(d.c.client.read().migration?.phase).toBe('completed');expect(d.c.client.read().savedToSelected).toBe(false);expect(d.c.client.read().autosave).toEqual(auto);expect(s.read()).toEqual(before);
 await s.observe();expect(d.c.client.read().autosave.mode).toBe('paused');expect(d.writes).toHaveBeenCalledTimes(1);
 expect(await d.c.client.load()).toBeNull();expect(d.c.client.read().confirmation).toBe('load');const loaded=await d.c.client.confirm();expect(loaded?.session.read().contactTarget).not.toBeNull();
});
it.each(['conflict','quota_exceeded','outcome_unknown','transaction_aborted'])('commit %s never reports saved or retries',async code=>{
 const d=await setup();const s=(await d.c.client.load())!.session;s.setDraft('保留');d.store.commitMigration=vi.fn(async()=>({ok:false as const,code}));
 await d.c.client.checkMigration!();await d.c.client.confirmMigration!();expect(d.c.client.read().migration?.phase).toBe(code==='outcome_unknown'?'unknown':'error');
 expect(d.c.client.read().busy).toBe(false);expect(s.read().draft).toBe('保留');expect(d.store.commitMigration).toHaveBeenCalledTimes(1);await d.c.client.confirmMigration!();expect(d.store.commitMigration).toHaveBeenCalledTimes(1);
 if(code==='conflict'||code==='outcome_unknown')expect(d.c.client.read().savedToSelected).toBe(false);
});
it('cancel stale preview then select leaves late result without a new confirmation',async()=>{
 const d=await setup();let resolve!:(r:SaveResult<MigrationTarget>)=>void;d.store.inspectMigration=()=>new Promise(r=>resolve=r);
 const pending=d.c.client.checkMigration!();d.c.client.select('manual-2');resolve({ok:true,value:{slotId:'manual-1',token:'old',previousToken:null,currentText:original,previousText:null,candidate:d.candidate}});await pending;
 expect(d.c.client.read().selectedSlot).toBe('manual-2');expect(d.c.client.read().migration?.phase).toBe('idle');await d.c.client.confirmMigration!();expect(d.commits).not.toHaveBeenCalled();
});
it.each(['inspect','commit'])('%s timeout is bounded, late completion cannot publish success',async stage=>{
 const d=await setup(25);let resolve!:(r:any)=>void;
 if(stage==='inspect')d.store.inspectMigration=()=>new Promise(r=>resolve=r);else d.store.commitMigration=()=>new Promise(r=>resolve=r);
 await d.c.client.checkMigration!();if(stage==='commit')await d.c.client.confirmMigration!();
 expect(d.c.client.read().migration?.phase).toBe(stage==='commit'?'unknown':'error');expect(d.c.client.read().busy).toBe(false);
 resolve({ok:true,value:stage==='commit'?{token:'late',document:d.candidate.document,previous:null}:{slotId:'manual-1',token:'old',previousToken:null,currentText:original,previousText:null,candidate:d.candidate}});
 await Promise.resolve();expect(d.c.client.read().migration?.phase).not.toMatch(/confirm|completed/);
});
it('original list exposes opaque choices only; exact raw export is not a save or load',async()=>{
 const d=await setup(),s=(await d.c.client.load())!.session;s.setDraft('keep');const before=s.read(),saved=d.c.client.read().savedToSelected;
 await d.c.client.listOriginals!();const view=d.c.client.read().originals!;expect(view.entries).toHaveLength(1);expect(JSON.stringify(view)).not.toContain('private-key');
 await d.c.client.exportOriginal!(view.entries[0]!.id);expect(d.download.prepare.mock.calls[0]![0]).toMatchObject({text:original});expect(d.c.client.read().originals?.phase).toBe('initiated');
 expect(s.read()).toEqual(before);expect(d.c.client.read().savedToSelected).toBe(saved);expect(d.commits).not.toHaveBeenCalled();
});
it('original list request ownership and download preparation reject late completions',async()=>{
 const d=await setup(25);let resolve!:(v:any)=>void;d.download.prepare=vi.fn(()=>new Promise(r=>resolve=r));
 await d.c.client.listOriginals!();const id=d.c.client.read().originals!.entries[0]!.id;await d.c.client.exportOriginal!(id);
 const prepared={start:vi.fn(),dispose:vi.fn()};resolve(prepared);await new Promise(r=>setTimeout(r,0));expect(prepared.start).not.toHaveBeenCalled();expect(prepared.dispose).toHaveBeenCalledTimes(1);expect(d.c.client.read().originals?.phase).toBe('error');
});
it('preview failure observes changed current without adopting a write binding',async()=>{
 const d=await setup();await d.c.client.load();d.heads.set('manual-1',{token:'new',document:d.candidate.document,previous:d.candidate.sourceDocument});d.store.inspectMigration=async()=>({ok:false,code:'already_current'});
 await d.c.client.checkMigration!();expect(d.c.client.read().savedToSelected).toBe(false);await d.c.client.save();expect(d.writes).not.toHaveBeenCalled();
});
it('v2 exported file names identify actual version',async()=>{
 const text=await encodeSaveVersioned(createContactPrototype(),meta),document=await decodeSaveVersioned(text);
 expect(exportFile({slotId:'manual-1',token:'t',text,kind:'valid',schemaVersion:document.schemaVersion,worldRevision:document.worldRevision}).filename).toContain('-v2-');
});
it.each(['upgrade','downgrade'])('ordinary %s import is refused before asking to replace',async direction=>{
 const d=await setup(),v2=d.candidate.document,v1=d.candidate.sourceDocument;
 d.store.importEmpty=vi.fn(async()=>({ok:false as const,code:'occupied'}));
 d.store.replaceImported=vi.fn(async()=>({ok:false as const,code:'not_expected'}));
 d.store.inspectImportTarget=async()=>({ok:true,value:{kind:'replace',token:'target',previousToken:null,text:direction==='upgrade'?original:d.candidate.text,document:direction==='upgrade'?v1:v2}});
 await d.c.client.prepareImport(new Blob([direction==='upgrade'?d.candidate.text:original]));
 expect(d.c.client.read().import.phase).toBe('error');expect(d.c.client.read().canConfirmImport).toBe(false);expect(d.c.client.read().import.message).toContain('不能');
 await d.c.client.confirmImport();expect(d.store.replaceImported).not.toHaveBeenCalled();
});
it('cancelling an in-flight commit reports unknown and never installs a late result',async()=>{
 const d=await setup();let resolve!:(v:any)=>void;d.store.commitMigration=()=>new Promise(r=>resolve=r);
 const s=(await d.c.client.load())!.session;s.setDraft('keep');await d.c.client.checkMigration!();const pending=d.c.client.confirmMigration!();expect(d.c.client.read().migration?.phase).toBe('writing');d.c.client.cancelMigration!();await pending;
 expect(d.c.client.read().migration?.phase).toBe('unknown');resolve({ok:true,value:{token:'late',document:d.candidate.document,previous:null}});await Promise.resolve();expect(d.c.client.read().migration?.phase).toBe('unknown');expect(s.read().draft).toBe('keep');
});

it('committed action immediately withdraws old original choices and explains how to download again',async()=>{
 const d=await setup(),s=(await d.c.client.load())!.session;
 await d.c.client.listOriginals!();const id=d.c.client.read().originals!.entries[0]!.id;
 const before=s.read().clock.worldRevision;await s.observe();s.setDraft('保留草稿');
 expect(s.read().clock.worldRevision).toBe(before+1);
 const view=d.c.client.read();expect(view.originals!.entries).toHaveLength(0);
 expect(view.originals!.message).toContain('重新列出');expect(view.canExportOriginal).toBe(false);
 await d.c.client.exportOriginal!(id);expect(d.download.prepare).not.toHaveBeenCalled();
 const state=s.read(),disk=JSON.stringify([...d.heads]),auto=view.autosave;
 await d.c.client.listOriginals!();await d.c.client.exportOriginal!(d.c.client.read().originals!.entries[0]!.id);
 expect(d.download.prepare.mock.calls[0]![0].text).toBe(original);
 expect(d.c.client.read().originals!.phase).toBe('initiated');expect(s.read()).toEqual(state);
 expect(JSON.stringify([...d.heads])).toBe(disk);expect(d.c.client.read().autosave).toEqual(auto);
 expect(d.writes).not.toHaveBeenCalled();
});

it('rejected free input keeps the original selection because no action committed',async()=>{
 const d=await setup(),s=(await d.c.client.load())!.session;await d.c.client.listOriginals!();
 const choices=d.c.client.read().originals,revision=s.read().clock.worldRevision;
 s.setDraft('我要杀死 NPC');await s.submitText();expect(s.read().clock.worldRevision).toBe(revision);
 expect(d.c.client.read().originals).toEqual(choices);
 await d.c.client.exportOriginal!(choices!.entries[0]!.id);expect(d.c.client.read().originals!.phase).toBe('initiated');
});

it('successful manual save withdraws selections before disk snapshot rotation can stale their keys',async()=>{
 const d=await setup();await d.c.client.load();await d.c.client.listOriginals!();
 d.store.write=async()=>{const value={...d.heads.get('manual-1')!,token:'rotated'};d.heads.set('manual-1',value);return{ok:true,value};};
 await d.c.client.save();expect(d.c.client.read().savedToSelected).toBe(true);
 expect(d.c.client.read().originals!.entries).toHaveLength(0);
 expect(d.c.client.read().originals!.message).toContain('重新列出');expect(d.c.client.read().canExportOriginal).toBe(false);
});

it('autosave advances its bound head but never restores invalidated original choices',async()=>{
 const d=await setup(),s=(await d.c.client.load())!.session;
 d.store.write=async(world)=>{const document=await decodeSaveVersioned(await encodeSaveVersioned(world,meta));const value={token:'auto-new',document,previous:d.candidate.sourceDocument};d.heads.set('manual-1',value);return{ok:true,value};};
 await d.c.client.enableAutosave();await d.c.client.listOriginals!();await s.observe();
 expect(d.heads.get('manual-1')!.token).toBe('auto-new');expect(d.c.client.read().savedToSelected).toBe(true);
 expect(d.c.client.read().autosave.mode).toBe('on');expect(d.c.client.read().originals!.entries).toHaveLength(0);
 expect(d.c.client.read().originals!.message).toContain('重新列出');expect(d.c.client.read().canExportOriginal).toBe(false);
});

for(const stage of ['list','export','prepare'] as const)for(const boundary of ['cancel','slot','session','load'] as const){
 it(`late ${stage} after ${boundary} cannot publish choices or download into another context`,async()=>{
  const d=await setup();await d.c.client.load();await d.c.client.listOriginals!();const id=d.c.client.read().originals!.entries[0]!.id;
  let release!:(value:any)=>void;const held=new Promise<any>(r=>release=r),prepared={start:vi.fn(),dispose:vi.fn()};
  const result=stage==='list'?await d.store.listMigrationOriginals!('manual-1',new AbortController().signal)
   :stage==='export'?await d.store.exportMigrationOriginal!('manual-1','private-key',new AbortController().signal):prepared;
  if(stage==='list')d.store.listMigrationOriginals=()=>held;
  if(stage==='export')d.store.exportMigrationOriginal=()=>held;
  if(stage==='prepare')d.download.prepare=vi.fn(()=>held);
  const pending=stage==='list'?d.c.client.listOriginals!():d.c.client.exportOriginal!(id);
  await Promise.resolve();await Promise.resolve();expect(d.c.client.read().busy).toBe(true);
  // Ordinary transitions are locked while a read/download is pending.
  d.c.client.select('manual-2');expect(d.c.client.read().selectedSlot).toBe('manual-1');
  expect(()=>d.c.start(createContactPrototype())).toThrow();expect(await d.c.client.load()).toBeNull();
  d.c.client.cancelMigration!();await pending;
  if(boundary==='slot')d.c.client.select('manual-2');
  if(boundary==='session')d.c.start(createContactPrototype());
  if(boundary==='load')expect(await d.c.client.load()).not.toBeNull();
  const view=d.c.client.read(),disk=JSON.stringify([...d.heads]);release(result);await new Promise(r=>setTimeout(r,0));
  expect(d.c.client.read()).toEqual(view);expect(JSON.stringify([...d.heads])).toBe(disk);
  expect(d.c.client.read().originals!.entries).toHaveLength(0);expect(prepared.start).not.toHaveBeenCalled();
  if(stage==='prepare')expect(prepared.dispose).toHaveBeenCalledTimes(1);else expect(d.download.prepare).not.toHaveBeenCalled();
 });
}

it.each(['list','export'] as const)('%s timeout ignores late result and permits only an explicit new attempt',async stage=>{
 const d=await setup(25);await d.c.client.load();await d.c.client.listOriginals!();const id=d.c.client.read().originals!.entries[0]!.id;
 let release!:(value:any)=>void;const held=new Promise<any>(r=>release=r);
 const list=d.store.listMigrationOriginals!,exportOriginal=d.store.exportMigrationOriginal!;
 const result=stage==='list'?await list('manual-1',new AbortController().signal):await exportOriginal('manual-1','private-key',new AbortController().signal);
 if(stage==='list')d.store.listMigrationOriginals=()=>held;else d.store.exportMigrationOriginal=()=>held;
 await(stage==='list'?d.c.client.listOriginals!():d.c.client.exportOriginal!(id));
 expect(d.c.client.read().originals!.phase).toBe('error');expect(d.c.client.read().busy).toBe(false);
 release(result);await new Promise(r=>setTimeout(r,0));expect(d.c.client.read().originals!.phase).toBe('error');expect(d.download.prepare).not.toHaveBeenCalled();
 d.store.listMigrationOriginals=list;d.store.exportMigrationOriginal=exportOriginal;
 await d.c.client.listOriginals!();await d.c.client.exportOriginal!(d.c.client.read().originals!.entries[0]!.id);
 expect(d.c.client.read().originals!.phase).toBe('initiated');expect(d.download.prepare).toHaveBeenCalledTimes(1);
});

it('export failure is recoverable and overlapping clicks start only one download',async()=>{
 const d=await setup();await d.c.client.listOriginals!();const id=d.c.client.read().originals!.entries[0]!.id,exportOriginal=d.store.exportMigrationOriginal!;
 d.store.exportMigrationOriginal=async()=>({ok:false,code:'unavailable'});await d.c.client.exportOriginal!(id);
 expect(d.c.client.read().originals!.phase).toBe('error');expect(d.download.prepare).not.toHaveBeenCalled();
 d.store.exportMigrationOriginal=exportOriginal;
 await Promise.all([d.c.client.exportOriginal!(id),d.c.client.exportOriginal!(id)]);
 expect(d.c.client.read().originals!.phase).toBe('initiated');expect(d.download.prepare).toHaveBeenCalledTimes(1);
 const lease=await d.download.prepare.mock.results[0]!.value;expect(lease.start).toHaveBeenCalledTimes(1);expect(lease.dispose).toHaveBeenCalledTimes(1);
});

it('same-ID replay through the real controller game does not revoke a freshly listed selection',async()=>{
 const originalFactory=games.createGame;let game!:ReturnType<typeof games.createGame>;
 const wrapped=vi.spyOn(games,'createGame').mockImplementation((...args)=>{game=originalFactory(...args);return game;});
 try{
  const d=await setup();await d.c.client.load();
  const world=d.candidate.sourceDocument.worldState;
  const command={commandId:'original-replay',actorId:world.player.playerId,source:'button',verb:'observe',targetIds:[],toolIds:[],arguments:{},utterance:'观察周围',expectedWorldRevision:world.campaign.worldRevision};
  await d.c.client.listOriginals!();const first=await game.dispatch(command);expect(first.ok).toBe(true);
  expect(d.c.client.read().originals!.entries).toHaveLength(0);await d.c.client.listOriginals!();
  const listed=d.c.client.read().originals;const replay=await game.dispatch(command);
  expect(replay).toMatchObject({ok:true,replayed:true});expect(d.c.client.read().originals).toEqual(listed);
  await d.c.client.exportOriginal!(listed!.entries[0]!.id);expect(d.c.client.read().originals!.phase).toBe('initiated');
 }finally{wrapped.mockRestore();}
});
