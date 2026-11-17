import {decodeSaveVersioned,encodeSaveVersioned} from '../../adapters/storage/save-versions';
import {createEngine} from '../../core/engine';
import {createContactPrototype} from '../../core/contact-prototype';
import {canonicalJSON} from '../../adapters/storage/save-format';
import {readActionReceipts,type ActionReceipt} from '../../core/receipts';
import {projectHistoryPage} from '../../application/history';
import {upgradeContactWorld} from '../../core/contact-prototype';
export {panelProof} from './history-check';
export {createIndexedDbStorage} from '../../adapters/storage/indexed-db';
function request(r:ActionReceipt){const q=r.request,door=r.rule.startsWith('door-observe');return{commandId:r.commandId,actorId:q.actorId,source:'button',utterance:'',toolIds:[],verb:door?'observe':r.rule.startsWith('cabinet-search')?'search':r.rule.split('-v')[0],targetIds:['doorId'in q?q.doorId:'itemId'in q?q.itemId:'destinationId'in q?q.destinationId:'cabinetId'in q?q.cabinetId:q.locationId],arguments:door?{through:'door_gap',careful:true}:r.rule==='talk-v1'?{topic:'greeting'}:{},expectedWorldRevision:q.expectedWorldRevision};}
function check(v:unknown,m:string){if(!v)throw Error(m);}
export async function prove(text:string,original?:string){
 const doc=await decodeSaveVersioned(text),engine=createEngine(doc.worldState),before=canonicalJSON(engine.snapshot());let replays=0;
 for(const receipt of readActionReceipts(doc.worldState)){const r=engine.dispatch(request(receipt));check(r.ok&&r.replayed,'replay rejected');check(canonicalJSON(engine.snapshot())===before,'replay mutated');replays++;}
 if(original){const source=await decodeSaveVersioned(original);check(canonicalJSON(doc.worldState)===canonicalJSON(source.worldState),'full world mismatch');}
 const p=projectHistoryPage(doc.worldState);return{schemaVersion:doc.schemaVersion,revision:doc.worldRevision,replays,journal:doc.eventJournal.length,history:Array.from({length:p.pages},(_,i)=>projectHistoryPage(doc.worldState,i+1)),rng:doc.rngState,relationshipCount:doc.worldState.relationships.length,memories:doc.worldState.stateSchema==='g2-world-v2'?doc.worldState.npcMemories.length:0};
}
export async function proveUpgrade(text:string,original:string){const a=await decodeSaveVersioned(text),b=await decodeSaveVersioned(original);check(a.schemaVersion===2&&b.schemaVersion===1,'version mapping');check(canonicalJSON(a.worldState)===canonicalJSON(upgradeContactWorld(b.worldState)),'upgrade changed old truth');return prove(text);}
export async function proveAdvance(before:string,after:string){const a=await decodeSaveVersioned(before),b=await decodeSaveVersioned(after),engine=createEngine(a.worldState);const unseen=readActionReceipts(b.worldState).filter(r=>r.committedRevision>a.worldRevision);for(const receipt of unseen){const result=engine.dispatch(request(receipt));check(result.ok&&!result.replayed,'next action failed');}check(canonicalJSON(engine.snapshot())===canonicalJSON(b.worldState),'next RNG/full facts diverged');return{newActions:unseen.length,fullWorldEqual:true,nextRngEqual:true};}
export async function fixture(status:'alive'|'dead'='alive'){
 const engine=createEngine(createContactPrototype(1,status)),commands:unknown[]=[];
 const steps=[['observe',null],['search','prototype-location'],['search','prototype-cabinet'],['pick_up','prototype-bottled-water'],['pick_up','prototype-tin'],['move','prototype-corridor'],['talk','prototype-corridor'],['talk','prototype-corridor'],['talk','prototype-corridor'],['move','prototype-location'],['door','prototype-door-gap']];
 for(const [verb,target]of steps){const w=engine.snapshot(),command={commandId:`contact-fixture-${w.campaign.worldRevision}`,actorId:w.player.playerId,source:'text',verb:verb==='door'?'observe':verb,targetIds:target?[target]:[],toolIds:[],arguments:verb==='talk'?{topic:'greeting'}:verb==='door'?{through:'door_gap',careful:true}:{},utterance:'',expectedWorldRevision:w.campaign.worldRevision};const r=engine.dispatch(command);check(r.ok,JSON.stringify(r));commands.push(command);}
 return{seed:1,status,commands,text:await encodeSaveVersioned(engine.snapshot(),{gameBuild:'g2-010-generated-fixture',savedAtUtc:'2026-10-26T00:00:00.000Z'})};
}
