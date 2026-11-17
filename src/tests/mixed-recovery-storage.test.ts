import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createIndexedDbStorage} from '../adapters/storage/indexed-db';
import {prepareV1Migration} from '../adapters/storage/migration';
import {encodeSaveVersioned} from '../adapters/storage/save-versions';
import {createContactPrototype} from '../core/contact-prototype';
const previous=readFileSync('src/tests/save-fixtures/v1.json','utf8'),meta={gameBuild:'mixed-test',savedAtUtc:'2026-10-26T00:00:00.000Z'};
function denied(){let opens=0;const store=createIndexedDbStorage({factory:{open(){opens++;throw Error('denied');}} as unknown as IDBFactory});return{store,opens:()=>opens};}
async function request(){return{slotId:'manual-1',expectedToken:'current',expectedPreviousToken:'previous',expectedCurrentText:await encodeSaveVersioned(createContactPrototype(),meta),expectedPreviousText:previous,candidateText:(await prepareV1Migration(previous,meta)).text};}
it('valid converted previous reaches DB only through the dedicated capability',async()=>{
 const d=denied();expect(typeof (d.store as any).restoreConvertedPrevious).toBe('function');
 expect(await (d.store as any).restoreConvertedPrevious(await request())).toEqual({ok:false,code:'storage_error'});expect(d.opens()).toBe(1);
});
it.each(['slot','token','same-tokens','previous','current','candidate-version','candidate-truth','cancel'] as const)('%s refuses before opening the database',async mode=>{
 const d=denied(),q:any=await request();if(mode==='slot')q.slotId='manual-4';if(mode==='token')q.expectedToken='';if(mode==='same-tokens')q.expectedPreviousToken=q.expectedToken;
 if(mode==='previous')q.expectedPreviousText=null;if(mode==='current')q.expectedCurrentText=previous;if(mode==='candidate-version')q.candidateText=previous;
 if(mode==='candidate-truth')q.candidateText=await encodeSaveVersioned(createContactPrototype(),meta);if(mode==='cancel'){const c=new AbortController();c.abort();q.signal=c.signal;}
 expect(typeof (d.store as any).restoreConvertedPrevious).toBe('function');expect((await(d.store as any).restoreConvertedPrevious(q)).ok).toBe(false);expect(d.opens()).toBe(0);
});
