import type {ManualSlotId,MigrationView,OriginalsView} from './ports';
import type {ManualSaveStore,MigrationTarget,MigrationOriginal,SlotContents} from '../adapters/storage/port';
import type {DownloadPort,PreparedDownload} from './save-export';
import {exportFile,exportFailure} from './save-export';
class Failure extends Error {constructor(readonly code:string){super(code);}}
interface Hooks {
 context():{key:string;slotId:ManualSlotId};lock(c:AbortController):boolean;unlock(c:AbortController):void;
 observed(id:ManualSlotId,contents:SlotContents):void;invalidate(id:ManualSlotId):void;emit():void;
}
const label=(id:ManualSlotId)=>`存档槽 ${id.slice(-1)}`;
function failure(code:string,writing:boolean):Pick<MigrationView,'phase'|'message'>{
 if(writing&&['outcome_unknown','timeout','cancelled','unexpected'].includes(code))return{phase:'unknown',message:'升级结果尚不能确定，当前游戏未切换。请主动刷新列表并检查目标槽、列出原件，不要盲目重复升级。'};
 const reason=code==='already_current'?'该槽已经是 v2，无需再次升级。请主动读取或列出原件。'
 :code==='conflict'?'目标版本或原文已改变，旧确认失效。请重新检查并确认。'
 :code==='quota_exceeded'?'本机空间不足，不能删除原件腾空间。请保留原件并检查存储空间。'
 :code==='previous_invalid'?'上一备份缺失或不是可无损保存的文本，无法确认完整保留。请列出可取得的原件并下载。'
 :code==='archive_conflict'?'已有归档与源原文冲突，未覆盖归档。请列出并保留原件。'
 :['cancelled','timeout'].includes(code)?'检查已取消或超时，可主动重新检查。'
 :'该槽暂不能升级，请检查版本、原件和浏览器存储权限后主动重试。';
 return{phase:'error',message:reason+' 当前游戏与输入保留；未确认升级成功。'};
}
/** Only opaque choice IDs and safe metadata leave this owner; candidates/raw bytes stay here. */
export function createMigrationFlow(store:ManualSaveStore,hooks:Hooks,timeoutMs:number,download?:DownloadPort){
 const idle=():MigrationView=>({phase:'idle',slotId:null,message:'可检查 v1 升级；确认后保留原件并生成 v2，之后需另行读取。'});
 const empty=():OriginalsView=>({phase:'idle',slotId:null,message:'可列出当前、上一备份和升级归档，下载原文；不会读取进游戏。',entries:Object.freeze([])});
 let view=idle(),originals=empty(),candidate:MigrationTarget|undefined,context:ReturnType<Hooks['context']>|undefined;
 let choices:readonly MigrationOriginal[]=[],choiceContext:string|undefined,controller:AbortController|undefined,serial=0;
 const preparing=()=>view.phase==='checking'||view.phase==='confirm';
 function reset(){candidate=undefined;context=undefined;choices=[];choiceContext=undefined;view=idle();originals=empty();}
 function invalidateOriginals(slotId?:ManualSlotId){
  if(!choices.length||(slotId!==undefined&&originals.slotId!==slotId))return;
  choices=[];choiceContext=undefined;
  originals={...originals,phase:'idle',entries:Object.freeze([]),message:'游戏进度或存档已变化，旧原件选择已撤销。请重新列出原件后再下载；原文件保留。'};
 }
 function cancel(){if(view.phase==='writing'){controller?.abort();return;}serial++;controller?.abort();if(controller)hooks.unlock(controller);controller=undefined;reset();hooks.emit();}
 async function execute(kind:'inspect'|'commit'|'list'|'export',work:(signal:AbortSignal,check:()=>void)=>Promise<void>){
  const own=new AbortController(),captured=hooks.context();if(!hooks.lock(own))return;const ticket=++serial;controller=own;
  const migration=kind==='inspect'||kind==='commit',writing=kind==='commit';
  if(migration)view={phase:writing?'writing':'checking',slotId:captured.slotId,message:`正在${writing?'保留原件并原子升级':'检查'}${label(captured.slotId)}…可继续编辑输入。`};
  else originals={...originals,phase:'reading',slotId:captured.slotId,message:`正在读取${label(captured.slotId)}原件…可继续编辑输入。`};hooks.emit();
  const check=()=>{if(own.signal.aborted||ticket!==serial||captured.key!==hooks.context().key)throw new Failure('cancelled');};
  let timer:ReturnType<typeof setTimeout>|undefined,stop:(()=>void)|undefined;
  try{await Promise.race([work(own.signal,check),new Promise<never>((_,reject)=>{stop=()=>reject(new Failure('cancelled'));own.signal.addEventListener('abort',stop,{once:true});timer=setTimeout(()=>{own.abort();reject(new Failure('timeout'));},timeoutMs);})]);}
  catch(e){if(ticket===serial&&captured.key===hooks.context().key){const code=e instanceof Failure?e.code:'unexpected';
   if(migration){candidate=undefined;context=undefined;const failed=failure(code,writing);if(failed.phase==='unknown'||code==='conflict')hooks.invalidate(captured.slotId);view={...failed,slotId:captured.slotId};}
   else originals={...originals,phase:'error',message:exportFailure(code)};
  }}finally{if(timer!==undefined)clearTimeout(timer);if(stop)own.signal.removeEventListener('abort',stop);hooks.unlock(own);if(controller===own)controller=undefined;hooks.emit();}
 }
 return{read:()=>Object.freeze({...view}),originals:()=>Object.freeze({...originals}),preparing,pending:()=>!!candidate,cancel,invalidateOriginals,
  async inspect(){if(view.phase==='writing')return;if(preparing())cancel();const target=hooks.context();await execute('inspect',async(signal,check)=>{
   if(!store.inspectMigration||!store.commitMigration)throw new Failure('unavailable');const r=await store.inspectMigration(target.slotId,signal);check();
   if(!r.ok){hooks.invalidate(target.slotId);if(store.readExisting)try{const current=await store.readExisting(target.slotId,signal);check();if(current.ok)hooks.observed(target.slotId,current.value);}catch{check();}throw new Failure(r.code);}
   hooks.observed(target.slotId,{token:r.value.token,document:r.value.candidate.sourceDocument,previous:null});candidate=r.value;context=target;
   view={phase:'confirm',slotId:target.slotId,message:`确认保留${label(target.slotId)}的 v1 原件并生成 v2？来源保存于 ${r.value.candidate.sourceDocument.savedAtUtc}，进度 ${r.value.candidate.sourceDocument.worldRevision}。当前与上一备份原文将永久保留，需要额外空间。当前游戏不切换，完成后需另行读取；旧程序只能导出 v2 原文，不能继续其中的新关系。取消保持当前游戏和原文件。`};
  });},
  async confirm(){if(!candidate||!context||view.phase!=='confirm'||context.key!==hooks.context().key)return;const chosen=candidate,target=context.slotId;candidate=undefined;context=undefined;
   await execute('commit',async(signal,check)=>{check();if(!store.commitMigration)throw new Failure('unavailable');const r=await store.commitMigration({slotId:target,expectedToken:chosen.token,expectedPreviousToken:chosen.previousToken,expectedCurrentText:chosen.currentText,expectedPreviousText:chosen.previousText,candidateText:chosen.candidate.text,signal});check();if(!r.ok)throw new Failure(r.code);
    hooks.observed(target,r.value);choices=[];choiceContext=undefined;originals=empty();view={phase:'completed',slotId:target,message:`${label(target)}已升级为 v2，原件保留。当前游戏未切换；请另行读取升级后的存档，或列出原件下载备份。`};
   });
  },
  async list(){const target=hooks.context();await execute('list',async(signal,check)=>{
   if(!store.listMigrationOriginals)throw new Failure('unavailable');const r=await store.listMigrationOriginals(target.slotId,signal);check();if(!r.ok)throw new Failure(r.code);
   choices=r.value;choiceContext=target.key;const entries=Object.freeze(choices.map((item,i)=>Object.freeze({id:`original-${i}`,label:`${item.source==='current'?'当前':item.source==='previous'?'上一备份':'升级归档'} · ${item.schemaVersion?`v${item.schemaVersion} · 进度 ${item.worldRevision}`:'损坏或不支持的文本原件'}${item.changedArchive?' · 原文与归档校验不一致，请保留检查':''}`})));
   originals={phase:'ready',slotId:target.slotId,message:entries.length?'请选择原件下载，文件包含完整世界，游戏中不预览内容。':'没有可取得的文本原件；已有数据库记录保留。',entries};
  });},
  async export(id:string){const target=hooks.context();if(choiceContext!==target.key)return;const index=originals.entries.findIndex(e=>e.id===id),chosen=choices[index];if(!chosen)return;
   await execute('export',async(signal,check)=>{if(!store.exportMigrationOriginal||!download)throw new Failure('unavailable');const r=await store.exportMigrationOriginal(target.slotId,chosen.key,signal);check();if(!r.ok)throw new Failure(r.code);let prepared:PreparedDownload|undefined;
    try{prepared=await download.prepare(exportFile(r.value),signal);check();prepared.start();originals={...originals,phase:'initiated',message:`${label(target.slotId)}原文：已发起下载，请在浏览器确认文件已保存。当前游戏与存档未改变。`};}finally{prepared?.dispose();}
   });
  },
 };
}
