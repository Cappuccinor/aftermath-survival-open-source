import type {RecoveryView,ManualSlotId} from './ports';
import type {ManualSaveStore,RecoveryTarget,MixedRecoveryTarget,SaveResult,SlotContents} from '../adapters/storage/port';
import {projectClock} from './clock';
class RecoveryFailure extends Error {constructor(readonly code:string){super(code);}}
interface Hooks {
  context():{key:string;slotId:ManualSlotId};
  lock(controller:AbortController):boolean;
  unlock(controller:AbortController):void;
  remember(slot:ManualSlotId,contents:SlotContents):void;
  observed(slot:ManualSlotId,contents:SlotContents):void;
  invalidate(slot:ManualSlotId):void;
  emit():void;
}
const label=(id:ManualSlotId)=>`存档槽 ${id.slice(-1)}`;
function failure(code:string,writing:boolean){
  if(writing&&['outcome_unknown','timeout','cancelled','unexpected'].includes(code))return{phase:'unknown' as const,message:'恢复结果尚不能确定，当前游戏未切换。请主动刷新列表并检查目标槽，不要盲目重复恢复。'};
  const reason=code==='conflict'?'目标版本或备份已改变，旧确认不能使用。请重新检查并确认。'
    :code==='cross_version_recovery_required'?'此版本组合不能直接恢复；仅支持明确地把 v2 当前档的健康 v1 上一备份转换为 v2。不能隐式降级，请列出原件并分别下载。'
    :code==='archive_conflict'?'保留归档与源原文不一致，未覆盖原件。请列出并下载原件后检查。'
    :['empty','no_previous','previous_invalid'].includes(code)?'没有可恢复的有效上一备份。请保留原件；健康当前档仍可读取或导出。'
    :['current_recovery_refused','invalid_format','missing_snapshot'].includes(code)?'当前存档或槽结构不在本次恢复范围内，不能原位覆盖。请保留或导出原件。'
    :code==='quota_exceeded'?'本机存储空间不足，未确认恢复成功。请保留原件并检查存储空间。'
    :['timeout','cancelled'].includes(code)?'检查超时或已取消，可主动重新检查；原件保留。'
    :'暂时无法检查或恢复本机备份，请检查存储权限后主动重试；原件保留。';
  return{phase:'error' as const,message:reason+' 当前游戏与输入保留；未确认恢复成功。'};
}
/** Full raw candidates stay in this trusted flow; presentation receives safe metadata only. */
export function createRecoveryFlow(store:ManualSaveStore,hooks:Hooks,timeoutMs:number){
  let view:RecoveryView={phase:'idle',slotId:null,message:'可检查所选槽的上一备份，另行确认恢复；不会自动切换当前游戏。'};
  let candidate:RecoveryTarget|MixedRecoveryTarget|undefined,context:ReturnType<Hooks['context']>|undefined,controller:AbortController|undefined,serial=0;
  const preparing=()=>view.phase==='checking'||view.phase==='confirm';
  function reset(){candidate=undefined;context=undefined;view={phase:'idle',slotId:null,message:'可主动检查上一备份；当前游戏未切换。'};}
  function cancel(){if(view.phase==='recovering'){controller?.abort();return;}serial++;controller?.abort();if(controller)hooks.unlock(controller);controller=undefined;reset();hooks.emit();}
  async function execute(writing:boolean,work:(signal:AbortSignal,check:()=>void)=>Promise<void>){
    const own=new AbortController(),ticket=++serial,captured=hooks.context();if(!hooks.lock(own))return;
    controller=own;view={phase:writing?'recovering':'checking',slotId:captured.slotId,message:`正在${writing?'原子恢复':'检查'}${label(captured.slotId)}的上一备份…可继续编辑输入。`};hooks.emit();
    const check=()=>{if(own.signal.aborted||serial!==ticket||hooks.context().key!==captured.key)throw new RecoveryFailure('cancelled');};
    let timer:ReturnType<typeof setTimeout>|undefined,stop:(()=>void)|undefined;
    try{await Promise.race([work(own.signal,check),new Promise<never>((_,reject)=>{stop=()=>reject(new RecoveryFailure('cancelled'));own.signal.addEventListener('abort',stop,{once:true});timer=setTimeout(()=>{own.abort();reject(new RecoveryFailure('timeout'));},timeoutMs);})]);}
    catch(error){if(serial===ticket&&hooks.context().key===captured.key){candidate=undefined;context=undefined;const code=error instanceof RecoveryFailure?error.code:'unexpected',failed=failure(code,writing);if(failed.phase==='unknown'||['conflict','current_recovery_refused','invalid_format','missing_snapshot','empty'].includes(code))hooks.invalidate(captured.slotId);view={...failed,slotId:captured.slotId};}}
    finally{if(timer!==undefined)clearTimeout(timer);if(stop)own.signal.removeEventListener('abort',stop);hooks.unlock(own);if(controller===own)controller=undefined;hooks.emit();}
  }
  return{
    read:()=>Object.freeze({...view}),preparing,pending:()=>candidate!==undefined,cancel,
    async inspect(){if(view.phase==='recovering')return;if(preparing())cancel();const target=hooks.context();await execute(false,async(signal,check)=>{if(!store.inspectPrevious||!store.recoverPrevious)throw new RecoveryFailure('unavailable');let r:SaveResult<RecoveryTarget|MixedRecoveryTarget>=await store.inspectPrevious(target.slotId,signal);check();
      if(!r.ok&&r.code==='cross_version_recovery_required'&&store.inspectConvertedPrevious&&store.restoreConvertedPrevious){r=await store.inspectConvertedPrevious(target.slotId,signal);check();}
      if(!r.ok){
        if(['previous_invalid','no_previous'].includes(r.code)){
          // Backup failure says nothing about current. Withdraw the old claim while
          // checking current within this operation's budget, without creating a DB.
          hooks.invalidate(target.slotId);
          if(store.readExisting){
            try{
              const current=await store.readExisting(target.slotId,signal);check();
              if(current.ok&&current.value.document)hooks.observed(target.slotId,current.value);
            }catch{check();}
          }
        }
        throw new RecoveryFailure(r.code);
      }
      if(r.value.currentDocument)hooks.observed(target.slotId,{token:r.value.token,document:r.value.currentDocument,previous:r.value.previousDocument});else hooks.invalidate(target.slotId);
      candidate=r.value;context=target;const converting='candidate' in r.value;
      const current=r.value.currentDocument?'保存于 '+r.value.currentDocument.savedAtUtc+' · '+projectClock(r.value.currentDocument.worldState).label:`已识别 v${converting?2:r.value.previousDocument.schemaVersion} 但当前版本不可读取`;
      const consequence=converting?'确认将 v1 上一备份转换为 v2 并恢复到旧进度？旧进度不包含该时点之后的后续事件或关系。需要额外空间；当前和上一备份的两份原文永久保留。当前游戏不会切换，完成后需另行读取。':'确认恢复？槽中当前版本会改变，旧原件保留；当前游戏不会切换，恢复后需主动读取。';
      view={phase:'confirm',slotId:target.slotId,...(converting?{conversion:'v1-to-v2' as const}:{}),message:`${label(target.slotId)}当前版本：${current}。上一备份：保存于 ${r.value.previousDocument.savedAtUtc} · ${projectClock(r.value.previousDocument.worldState).label}。${consequence}`};});},
    async confirm(){if(!candidate||!context||view.phase!=='confirm'||hooks.context().key!==context.key)return;const chosen=candidate,target=context.slotId;candidate=undefined;context=undefined;await execute(true,async(signal,check)=>{
      check();const request={slotId:target,expectedToken:chosen.token,expectedPreviousToken:chosen.previousToken,expectedCurrentText:chosen.currentText,expectedPreviousText:chosen.previousText,signal};let r:SaveResult<SlotContents>;
      if('candidate' in chosen){if(!store.restoreConvertedPrevious)throw new RecoveryFailure('unavailable');r=await store.restoreConvertedPrevious({...request,candidateText:chosen.candidate.text});}
      else{if(!store.recoverPrevious)throw new RecoveryFailure('unavailable');r=await store.recoverPrevious(request);}
      check();if(!r.ok)throw new RecoveryFailure(r.code);hooks.remember(target,r.value);
      view={phase:'recovered',slotId:target,message:'candidate' in chosen?`已将${label(target)}的 v1 上一备份转换为 v2 并恢复到旧进度；两份原文永久保留，后续事件不在此旧进度中。当前游戏未切换，请另行读取。`:`已恢复${label(target)}的上一备份，旧原件保留。当前游戏未切换；需主动读取恢复后的存档。`};
    });}
  };
}
