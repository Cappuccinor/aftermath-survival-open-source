import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {decodeSaveVersioned} from '../adapters/storage/save-versions';
import {createContactPrototype} from '../core/contact-prototype';
import {createEngine} from '../core/engine';
it.each(['alive','dead'] as const)('actual generated %s v2 fixture is reproducible from recorded commands, never hand-filled truth',async status=>{
 const base=`docs/evidence/g2-010/fixtures/${status}-v2`,raw=readFileSync(base+'.json','utf8'),record=JSON.parse(readFileSync(base+'.provenance.json','utf8'));
 expect(createHash('sha256').update(raw).digest('hex')).toBe(record.sha256);expect(record.status).toBe(status);expect(record.seed).toBe(1);
 const engine=createEngine(createContactPrototype(record.seed,status));for(const command of record.commands)expect(engine.dispatch(command).ok).toBe(true);
 const document=await decodeSaveVersioned(raw);expect(document.worldState).toEqual(engine.snapshot());expect(document.eventJournal).toEqual(engine.snapshot().eventJournal);
 expect(document.worldState.relationships).toHaveLength(status==='alive'?1:0);
 if(document.worldState.stateSchema==='g2-world-v2')expect(document.worldState.npcMemories).toHaveLength(status==='alive'?2:0);
 const before=engine.snapshot();for(const command of record.commands)expect(engine.dispatch(command)).toMatchObject({ok:true,replayed:true});expect(engine.snapshot()).toEqual(before);
});
