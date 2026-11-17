// Isolated actual UI/controller/native-IDB composition. Never imported by production.
import {createPersistenceController} from '../../application/persistence';
import {createIndexedDbStorage} from '../../adapters/storage/indexed-db';
import {createContactPrototype} from '../../core/contact-prototype';
import {createEngine} from '../../core/engine';
import {mountObservationUI} from '../../ui/main';
import type {PortResult} from '../../application/ports';
let settle:((rejected:boolean)=>void)|undefined;
export function finish(rejected:boolean){settle?.(rejected);}
export const providerInputs:unknown[]=[];
export function install(){
 const engine=createEngine(createContactPrototype());engine.dispatch({commandId:'feedback-arrive',actorId:engine.snapshot().player.playerId,source:'button',verb:'move',targetIds:['prototype-corridor'],toolIds:[],arguments:{},utterance:'',expectedWorldRevision:0});
 const c=createPersistenceController(createIndexedDbStorage(),{narrationTimeoutMs:1000,narrator:{narrate:outcome=>{providerInputs.push(outcome);return new Promise<PortResult<string>>((resolve,reject)=>{settle=rejected=>rejected?reject(Error('isolated failure')):resolve({ok:true,value:outcome.summary});});}}});
 mountObservationUI(document.querySelector<HTMLElement>('#app')!,()=>c.start(engine.snapshot()).session,undefined,c.client);
}
