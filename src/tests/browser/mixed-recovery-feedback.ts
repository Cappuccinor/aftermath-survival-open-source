// Hold only delivery of a real committed native result; no production hook or budget change.
import {createIndexedDbStorage} from '../../adapters/storage/indexed-db';
import {createPersistenceController} from '../../application/persistence';
import {mountObservationUI} from '../../ui/main';
import {createContactPrototype} from '../../core/contact-prototype';
let release:(()=>void)|undefined;export let writes=0;
export function finish(){release?.();}
export function install(){
 const native=createIndexedDbStorage(),store={...native,restoreConvertedPrevious:async(request:Parameters<NonNullable<typeof native.restoreConvertedPrevious>>[0])=>{
  writes++;const result=await native.restoreConvertedPrevious!(request);if(!result.ok)return result;
  return new Promise<typeof result>(resolve=>{release=()=>resolve(result);});
 }};
 const c=createPersistenceController(store,{timeoutMs:500});mountObservationUI(document.querySelector<HTMLElement>('#app')!,()=>c.start(createContactPrototype()).session,undefined,c.client);
}
