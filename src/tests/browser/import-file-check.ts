import { canonicalJSON, decodeSave } from '../../adapters/storage/save-format';
import { createEngine } from '../../core/engine';
import { readActionReceipts } from '../../core/receipts';
import { visibleDoorTargets } from '../../core/door-observation';
export async function verifyImportedWorld(text:string, original:string, advanced?:string) {
 const saved=await decodeSave(text),source=await decodeSave(original),engine=createEngine(saved.worldState),baseline=createEngine(source.worldState);
 if(text!==original||canonicalJSON(engine.snapshot())!==canonicalJSON(source.worldState))throw Error('Original bytes/full truth lost');
 const before=canonicalJSON(engine.snapshot());let replayed=0;
 for(const receipt of readActionReceipts(saved.worldState)){const r=receipt.request,door='doorId' in r;const command={commandId:receipt.commandId,actorId:r.actorId,source:'button',utterance:'',toolIds:[],verb:door?'observe':receipt.rule.startsWith('cabinet-search')?'search':receipt.rule.replace(/-v\d+$/,''),targetIds:[door?r.doorId:'itemId' in r?r.itemId:'destinationId' in r?r.destinationId:'cabinetId' in r?r.cabinetId:r.locationId],arguments:door?{through:'door_gap',careful:true}:{},expectedWorldRevision:r.expectedWorldRevision};const result=engine.dispatch(command);if(!result.ok||!result.replayed||canonicalJSON(engine.snapshot())!==before)throw Error('Original command replay changed world');replayed++;}
 if(advanced){const next=await decodeSave(advanced),receipts=readActionReceipts(next.worldState),last=receipts.at(-1)!;const door=visibleDoorTargets(saved.worldState)[0];const cmd={commandId:last.commandId,actorId:saved.worldState.player.playerId,source:'button',verb:'observe',targetIds:door?[door.targetId]:[],toolIds:[],arguments:door?{through:'door_gap',careful:true}:{},utterance:'',expectedWorldRevision:saved.worldRevision};if(!baseline.dispatch(cmd).ok||canonicalJSON(baseline.snapshot())!==canonicalJSON(next.worldState))throw Error('Public loaded action differs from uninterrupted engine');}
 return {worldRevision:saved.worldRevision,eventCount:saved.eventJournal.length,replayed,fullWorldEqual:true,publicNextRngEqual:!!advanced};
}
