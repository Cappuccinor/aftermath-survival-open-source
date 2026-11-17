import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateImportFile, MAX_IMPORT_BYTES } from '../application/save-import';
const raw = readFileSync('src/tests/save-fixtures/v1.json', 'utf8');
const file = (text: string) => new Blob([text], { type: 'text/html' });
const signal = () => new AbortController().signal;
describe('strict import file boundary', () => {
  it('accepts exact original v1 with arbitrary MIME and whitespace', async () => { const text = '\n'+raw+'\n'; const r = await validateImportFile(file(text), signal()); expect(r.text).toBe(text); expect(r.document.worldRevision).toBe(24); });
  it('includes exactly16MiB; rejects above before reading', async () => {
    const text = raw+' '.repeat(MAX_IMPORT_BYTES-new TextEncoder().encode(raw).length);
    expect((await validateImportFile(file(text), signal())).text).toBe(text);
    let read = false; await expect(validateImportFile({size:MAX_IMPORT_BYTES+1,arrayBuffer:async()=>{read=true;return new ArrayBuffer(0);}},signal())).rejects.toThrow('file_too_large'); expect(read).toBe(false);
  });
  for(const [label,text] of [['empty',''],['html','<script>SECRET</script>'],['BOM','\uFEFF'+raw],['future',JSON.stringify({...JSON.parse(raw),schemaVersion:99})],['checksum',JSON.stringify({...JSON.parse(raw),checksums:{state:'0'.repeat(64)}})],['legacy',JSON.stringify(JSON.parse(raw).worldState)]]) it('rejects '+label,async()=>{await expect(validateImportFile(file(text!),signal())).rejects.toThrow();});
  it('rejects invalid UTF8 without replacement',async()=>{await expect(validateImportFile(new Blob([new Uint8Array([0xc0,0xaf])]),signal())).rejects.toThrow('invalid_utf8');});
  it('rejects size lies and read failure',async()=>{await expect(validateImportFile({size:4,arrayBuffer:async()=>new ArrayBuffer(1)},signal())).rejects.toThrow('file_changed');await expect(validateImportFile({size:4,arrayBuffer:async()=>{throw Error('SECRET');}},signal())).rejects.toThrow('file_read_error');});
  it('rejects preabort and late read after abort',async()=>{const c=new AbortController();c.abort();await expect(validateImportFile(file(raw),c.signal)).rejects.toThrow('cancelled');const d=new AbortController();let resolve!:(b:ArrayBuffer)=>void;const pending=validateImportFile({size:new TextEncoder().encode(raw).length,arrayBuffer:()=>new Promise(r=>resolve=r)},d.signal);d.abort();resolve(await file(raw).arrayBuffer());await expect(pending).rejects.toThrow('cancelled');});
});
