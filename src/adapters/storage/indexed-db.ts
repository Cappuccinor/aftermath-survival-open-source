import { canonicalJSON, SaveFormatError } from './save-format';
import { decodeSaveVersioned as decodeSave, encodeSaveVersioned as encodeSave } from './save-versions';
import { prepareV1Migration, rawDigest, archiveKey, migrationRecordSchema } from './migration';
import {prepareMixedRecovery,MixedRecoveryError,recoveryRecordSchema} from './mixed-recovery';
import { freezeSnapshot } from '../../core/schema';
import type { MigrationOriginal } from './port';
import type { ManualSaveStore, SaveResult, SlotContents, RecoveryTarget } from './port';
import type { ManualSlotId } from '../../application/ports';
export interface IndexedDbOptions { readonly factory?: IDBFactory; readonly databaseName?: string; readonly timeoutMs?: number }
interface Head { token: string; previousToken: string | null }
interface RawSlot { head: Head | null; current: string | null; previous: unknown }
class StorageFailure extends Error { constructor(readonly code: string) { super(code); } }
function validSlot(value: unknown): value is ManualSlotId { return value === 'manual-1' || value === 'manual-2' || value === 'manual-3'; }
function guard(signal: AbortSignal) { if (signal.aborted) throw new StorageFailure('cancelled'); }
function checkedHead(input: unknown): Head | null {
  if (input === undefined) return null;
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).sort().join(',') !== 'previousToken,token'
    || !('token' in input) || typeof input.token !== 'string' || !input.token
    || !('previousToken' in input) || (input.previousToken !== null && typeof input.previousToken !== 'string')
    || input.token === input.previousToken) throw new StorageFailure('invalid_format');
  return input as Head;
}

export function createIndexedDbStorage(options: IndexedDbOptions = {}): ManualSaveStore {
  const timeoutMs = options.timeoutMs ?? 4000, name = options.databaseName ?? 'aftermath-survival';
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw Error('Invalid storage timeout');
  const factory = options.factory ?? (typeof indexedDB === 'undefined' ? undefined : indexedDB);

  async function bounded<T>(signal: AbortSignal | undefined, operation: (signal: AbortSignal) => Promise<T>): Promise<SaveResult<T>> {
    const abort = new AbortController(); let timedOut = false;
    const cancel = () => abort.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    const timer = setTimeout(() => { timedOut = true; cancel(); }, timeoutMs);
    let stop: (() => void) | undefined;
    const cancelled = new Promise<never>((_, reject) => {
      stop = () => reject(new StorageFailure(timedOut ? 'timeout' : 'cancelled'));
      abort.signal.addEventListener('abort', stop, { once: true });
      if (abort.signal.aborted) stop();
    });
    try { return { ok: true, value: await Promise.race([operation(abort.signal), cancelled]) }; }
    catch (error) {
      return { ok: false, code: timedOut ? 'timeout' : error instanceof StorageFailure || error instanceof SaveFormatError || error instanceof MixedRecoveryError ? error.code
        : error instanceof DOMException && error.name === 'QuotaExceededError' ? 'quota_exceeded' : 'storage_error' };
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', cancel);
      if (stop) abort.signal.removeEventListener('abort', stop);
    }
  }
  function open(signal: AbortSignal, create = true): Promise<IDBDatabase> {
    guard(signal);
    return new Promise((resolve, reject) => {
      if (!factory) { reject(new StorageFailure('unavailable')); return; }
      let settled = false;
      const request = factory.open(name, 1);
      const fail = (error: unknown) => { if (settled) return; settled = true; signal.removeEventListener('abort', cancelled); reject(error); };
      const cancelled = () => fail(new StorageFailure('cancelled'));
      signal.addEventListener('abort', cancelled, { once: true });
      request.onupgradeneeded = () => {
        if (!create) { request.transaction?.abort(); fail(new StorageFailure('empty')); return; }
        if (signal.aborted || settled) { request.transaction?.abort(); return; }
        const connection = request.result;
        connection.createObjectStore('heads'); connection.createObjectStore('snapshots');
      };
      request.onblocked = () => fail(new StorageFailure('blocked'));
      request.onerror = () => fail(request.error);
      request.onsuccess = () => {
        const connection = request.result;
        connection.onversionchange = () => connection.close();
        if (settled || signal.aborted) { connection.close(); return; }
        settled = true; signal.removeEventListener('abort', cancelled); resolve(connection);
      };
    });
  }
  function transaction<T>(connection: IDBDatabase, mode: IDBTransactionMode, signal: AbortSignal,
    start: (tx: IDBTransaction, value: (result: T) => void, fail: (code: string) => void) => void): Promise<T> {
    guard(signal);
    return new Promise((resolve, reject) => {
      const tx = connection.transaction(['heads', 'snapshots'], mode);
      let result: T, assigned = false, failure: unknown;
      const cancel = () => { failure = new StorageFailure('cancelled'); try { tx.abort(); } catch { /* Already completed; oncomplete decides. */ } };
      const clean = () => signal.removeEventListener('abort', cancel);
      signal.addEventListener('abort', cancel, { once: true });
      tx.oncomplete = () => { clean(); assigned ? resolve(result) : reject(new StorageFailure('storage_error')); };
      tx.onabort = () => { clean(); reject(failure ?? tx.error ?? new StorageFailure('transaction_aborted')); };
      const fail = (code: string) => { failure = new StorageFailure(code); tx.abort(); };
      try { start(tx, value => { result = value; assigned = true; }, fail); }
      catch (error) { failure = error; tx.abort(); }
    });
  }
  async function readRaw(slot: ManualSlotId, signal: AbortSignal, create = true): Promise<RawSlot> {
    const connection = await open(signal, create);
    try {
      return await transaction(connection, 'readonly', signal, (tx, done, fail) => {
        const request = tx.objectStore('heads').get(slot);
        request.onsuccess = () => {
          let head: Head | null;
          try { head = checkedHead(request.result); } catch { fail('invalid_format'); return; }
          if (!head) { done({ head: null, current: null, previous: null }); return; }
          const result: RawSlot = { head, current: null, previous: null };
          const current = tx.objectStore('snapshots').get(head.token);
          current.onsuccess = () => { if (typeof current.result !== 'string') fail('invalid_format'); else result.current = current.result; };
          if (head.previousToken) {
            const previous = tx.objectStore('snapshots').get(head.previousToken);
            previous.onsuccess = () => { result.previous = previous.result; };
          }
          done(result);
        };
      });
    } finally { connection.close(); }
  }
  async function validated(raw: RawSlot): Promise<SlotContents> {
    const document = raw.current === null ? null : await decodeSave(raw.current);
    let previous = null;
    let backupWarning: 'invalid_backup' | undefined;
    if (raw.head?.previousToken) {
      try {
        if (typeof raw.previous !== 'string') throw new StorageFailure('invalid_format');
        previous = await decodeSave(raw.previous);
      } catch { backupWarning = 'invalid_backup'; }
    }
    return Object.freeze({ token: raw.head?.token ?? null, document, previous,
      ...(backupWarning ? { backupWarning } : {}) });
  }
  async function importDocument(text: string) {
    if (typeof text !== 'string' || text.length > 16 * 1024 * 1024) throw new StorageFailure('file_too_large');
    const bytes = new TextEncoder().encode(text);
    if (bytes.length > 16 * 1024 * 1024) throw new StorageFailure('file_too_large');
    if (new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) !== text) throw new StorageFailure('invalid_utf8');
    return decodeSave(text);
  }
  async function recoveryDocuments(currentText: string, previousText: string) {
    let currentDocument = null, currentIssue: RecoveryTarget['currentIssue'] = null;
    try { currentDocument = await decodeSave(currentText); }
    catch (error) {
      if (!(error instanceof SaveFormatError)) throw error;
      if (error.code === 'checksum_mismatch' || error.code === 'inconsistent_fields' || error.code === 'invalid_world') currentIssue = error.code;
      else throw new StorageFailure('current_recovery_refused');
    }
    let previousDocument;
    try { previousDocument = await decodeSave(previousText); }
    catch { throw new StorageFailure('previous_invalid'); }
    if (JSON.parse(currentText).schemaVersion !== previousDocument.schemaVersion) throw new StorageFailure('cross_version_recovery_required');
    return { currentDocument, currentIssue, previousDocument };
  }
  async function originalTexts(slot: ManualSlotId, signal: AbortSignal) {
    const connection = await open(signal, false);
    let captured: { head: unknown; keys: IDBValidKey[]; values: unknown[] };
    try {
      captured = await transaction(connection, 'readonly', signal, (tx, done) => {
        const head = tx.objectStore('heads').get(slot), keys = tx.objectStore('snapshots').getAllKeys(), values = tx.objectStore('snapshots').getAll();
        const result: typeof captured = { head: undefined, keys: [], values: [] };
        head.onsuccess = () => { result.head = head.result; };
        keys.onsuccess = () => { result.keys = keys.result; };
        values.onsuccess = () => { result.values = values.result; };
        done(result);
      });
    } finally { connection.close(); }
    guard(signal);
    const head = checkedHead(captured.head), snapshots = new Map(captured.keys.map((k, i) => [k, captured.values[i]]));
    const originals = new Map<string, { key: string; source: MigrationOriginal['source']; text: string; expectedHash?: string }>();
    const add = (key: string, source: MigrationOriginal['source'], token: string, expectedHash?: string) => {
      const text = snapshots.get(token);
      if (typeof text === 'string') originals.set(key, { key, source, text, ...(expectedHash ? { expectedHash } : {}) });
    };
    if (head) {
      add(`current:${head.token}`, 'current', head.token);
      if (head.previousToken) add(`previous:${head.previousToken}`, 'previous', head.previousToken);
    }
    for (const [key, text] of snapshots) {
      if (typeof key !== 'string' || (!key.startsWith('migration-record:')&&!key.startsWith('recovery-record:')) || typeof text !== 'string') continue;
      let json: unknown; try { json = JSON.parse(text); } catch { continue; }
      const recovering=key.startsWith('recovery-record:');
      const record = recovering?recoveryRecordSchema.safeParse(json):migrationRecordSchema.safeParse(json);
      if (!record.success || record.data.slotId !== slot || key !== `${recovering?'recovery':'migration'}-record:${record.data.destinationToken}`) continue;
      const r = record.data;
      if (r.sourceArchiveKey === archiveKey(r.sourceHash)) add(r.sourceArchiveKey, 'archive', r.sourceArchiveKey, r.sourceHash);
      if (r.previousHash && r.previousArchiveKey === archiveKey(r.previousHash)) add(r.previousArchiveKey, 'archive', r.previousArchiveKey, r.previousHash);
    }
    return [...originals.values()];
  }
  return Object.freeze<ManualSaveStore>({
    inspectConvertedPrevious(slot,signal){
      if(!validSlot(slot))return Promise.resolve({ok:false,code:'invalid_slot'});
      return bounded(signal,async active=>{
        const raw=await readRaw(slot,active,false);
        if(!raw.head||raw.current===null)throw new StorageFailure('empty');
        if(!raw.head.previousToken)throw new StorageFailure('no_previous');
        if(typeof raw.previous!=='string')throw new StorageFailure('previous_invalid');
        const converted=await prepareMixedRecovery(raw.current,raw.previous,{gameBuild:'g2-011',savedAtUtc:new Date().toISOString()});guard(active);
        return freezeSnapshot({slotId:slot,token:raw.head.token,previousToken:raw.head.previousToken,currentText:raw.current,previousText:raw.previous,...converted});
      });
    },
    async restoreConvertedPrevious(request){
      if(!request||!validSlot(request.slotId))return{ok:false,code:'invalid_slot'};
      let submitted=false;
      const result=await bounded(request.signal,async active=>{
        const expected=checkedHead({token:request.expectedToken,previousToken:request.expectedPreviousToken});
        if(!expected?.previousToken||typeof request.expectedCurrentText!=='string'||typeof request.expectedPreviousText!=='string'||typeof request.candidateText!=='string')throw new StorageFailure('invalid_format');
        const proposed=await decodeSave(request.candidateText);
        if(proposed.schemaVersion!==2)throw new StorageFailure('invalid_migration_candidate');
        const converted=await prepareMixedRecovery(request.expectedCurrentText,request.expectedPreviousText,{gameBuild:proposed.gameBuild,savedAtUtc:proposed.savedAtUtc});
        if(converted.candidate.text!==request.candidateText)throw new StorageFailure('invalid_migration_candidate');
        const previousHash=converted.candidate.sourceHash,entries=[...new Map([[archiveKey(converted.currentHash),request.expectedCurrentText],[archiveKey(previousHash),request.expectedPreviousText]]).entries()];guard(active);
        const connection=await open(active,false),token=crypto.randomUUID();
        const record=recoveryRecordSchema.parse({kind:'previous-v1-to-v2',slotId:request.slotId,sourceToken:expected.token,sourcePreviousToken:expected.previousToken,
          sourceHash:converted.currentHash,sourceArchiveKey:archiveKey(converted.currentHash),previousHash,previousArchiveKey:archiveKey(previousHash),destinationToken:token,migratedAtUtc:converted.candidate.document.savedAtUtc});
        try{
          submitted=true;
          return await transaction<SlotContents>(connection,'readwrite',active,(tx,done,fail)=>{
            const heads=tx.objectStore('heads'),snapshots=tx.objectStore('snapshots'),found=heads.get(request.slotId);
            const write=(work:()=>void)=>{try{work();}catch(error){fail(error instanceof DOMException&&error.name==='QuotaExceededError'?'quota_exceeded':'storage_error');}};
            const retain=(index:number)=>write(()=>{
              const entry=entries[index];
              if(!entry){snapshots.add(canonicalJSON(record),`recovery-record:${token}`);snapshots.add(converted.candidate.text,token);heads.put({token,previousToken:expected.token},request.slotId);
                done(Object.freeze({token,document:converted.candidate.document,previous:converted.currentDocument,...(converted.currentIssue?{backupWarning:'invalid_backup' as const}:{})}));return;}
              const [key,text]=entry,existing=snapshots.get(key);
              existing.onsuccess=()=>write(()=>{if(existing.result!==undefined&&existing.result!==text){fail('archive_conflict');return;}if(existing.result===undefined)snapshots.add(text,key);retain(index+1);});
            });
            found.onsuccess=()=>{
              let head:Head|null;try{head=checkedHead(found.result);}catch{fail('conflict');return;}
              if(!head||head.token!==expected.token||head.previousToken!==expected.previousToken){fail('conflict');return;}
              const current=snapshots.get(head.token);
              current.onsuccess=()=>{if(current.result!==request.expectedCurrentText){fail('conflict');return;}const previous=snapshots.get(expected.previousToken!);
                previous.onsuccess=()=>{if(previous.result!==request.expectedPreviousText)fail('conflict');else retain(0);};};
            };
          });
        }finally{connection.close();}
      });
      if(!result.ok&&submitted&&['timeout','cancelled'].includes(result.code))return{ok:false,code:'outcome_unknown'};
      return result;
    },
    inspectMigration(slot, signal) {
      if (!validSlot(slot)) return Promise.resolve({ ok: false, code: 'invalid_slot' });
      return bounded(signal, async active => {
        const raw = await readRaw(slot, active, false);
        if (!raw.head || raw.current === null) throw new StorageFailure('empty');
        const document = await decodeSave(raw.current); guard(active);
        if (document.schemaVersion === 2) throw new StorageFailure('already_current');
        if (raw.head.previousToken !== null && typeof raw.previous !== 'string') throw new StorageFailure('previous_invalid');
        const previousText = raw.head.previousToken === null ? null : raw.previous as string;
        if (previousText !== null) await rawDigest(previousText);
        const candidate = await prepareV1Migration(raw.current, { gameBuild: 'g2-010', savedAtUtc: new Date().toISOString() }); guard(active);
        return freezeSnapshot({ slotId: slot, token: raw.head.token, previousToken: raw.head.previousToken,
          currentText: raw.current, previousText, candidate });
      });
    },
    async commitMigration(request) {
      if (!request || !validSlot(request.slotId)) return { ok: false, code: 'invalid_slot' };
      let submitted = false;
      const result = await bounded(request.signal, async active => {
        const expected = checkedHead({ token: request.expectedToken, previousToken: request.expectedPreviousToken });
        if (!expected || typeof request.expectedCurrentText !== 'string' || typeof request.candidateText !== 'string'
          || (expected.previousToken === null ? request.expectedPreviousText !== null : typeof request.expectedPreviousText !== 'string')) throw new StorageFailure('invalid_format');
        const proposed = await decodeSave(request.candidateText);
        if (proposed.schemaVersion !== 2) throw new StorageFailure('invalid_migration_candidate');
        const candidate = await prepareV1Migration(request.expectedCurrentText, { gameBuild: proposed.gameBuild, savedAtUtc: proposed.savedAtUtc });
        if (candidate.text !== request.candidateText) throw new StorageFailure('invalid_migration_candidate');
        const previousHash = request.expectedPreviousText === null ? null : await rawDigest(request.expectedPreviousText);
        const originals = new Map([[archiveKey(candidate.sourceHash), request.expectedCurrentText]]);
        if (previousHash && request.expectedPreviousText !== null) originals.set(archiveKey(previousHash), request.expectedPreviousText);
        const entries = [...originals.entries()]; guard(active);
        const connection = await open(active, false), token = crypto.randomUUID();
        const record = migrationRecordSchema.parse({ kind: 'v1-to-v2', slotId: request.slotId,
          sourceToken: expected.token, sourcePreviousToken: expected.previousToken,
          sourceHash: candidate.sourceHash, sourceArchiveKey: archiveKey(candidate.sourceHash),
          previousHash, previousArchiveKey: previousHash ? archiveKey(previousHash) : null,
          destinationToken: token, migratedAtUtc: candidate.document.savedAtUtc });
        try {
          submitted = true;
          return await transaction<SlotContents>(connection, 'readwrite', active, (tx, done, fail) => {
            const heads = tx.objectStore('heads'), snapshots = tx.objectStore('snapshots'), found = heads.get(request.slotId);
            const retain = (index: number) => {
              const entry = entries[index];
              if (!entry) {
                snapshots.add(canonicalJSON(record), `migration-record:${token}`);
                snapshots.add(candidate.text, token);
                heads.put({ token, previousToken: expected.token }, request.slotId);
                done(Object.freeze({ token, document: candidate.document, previous: candidate.sourceDocument })); return;
              }
              const [key, text] = entry, existing = snapshots.get(key);
              existing.onsuccess = () => {
                if (existing.result !== undefined && existing.result !== text) { fail('archive_conflict'); return; }
                if (existing.result === undefined) snapshots.add(text, key);
                retain(index + 1);
              };
            };
            found.onsuccess = () => {
              let head: Head | null; try { head = checkedHead(found.result); } catch { fail('conflict'); return; }
              if (!head || head.token !== expected.token || head.previousToken !== expected.previousToken) { fail('conflict'); return; }
              const current = snapshots.get(head.token);
              current.onsuccess = () => {
                if (current.result !== request.expectedCurrentText) { fail('conflict'); return; }
                if (head.previousToken === null) { retain(0); return; }
                const previous = snapshots.get(head.previousToken);
                previous.onsuccess = () => { if (previous.result !== request.expectedPreviousText) fail('conflict'); else retain(0); };
              };
            };
          });
        } finally { connection.close(); }
      });
      if (!result.ok && submitted && ['timeout', 'cancelled'].includes(result.code)) return { ok: false, code: 'outcome_unknown' };
      return result;
    },
    listMigrationOriginals(slot, signal) {
      if (!validSlot(slot)) return Promise.resolve({ ok: false, code: 'invalid_slot' });
      return bounded(signal, async active => {
        const originals = await originalTexts(slot, active), result: MigrationOriginal[] = [];
        for (const item of originals) {
          let document = null; try { document = await decodeSave(item.text); } catch (error) { if (!(error instanceof SaveFormatError)) throw error; }
          const changedArchive = !!item.expectedHash && await rawDigest(item.text) !== item.expectedHash; guard(active);
          result.push(Object.freeze({ key: item.key, source: item.source, schemaVersion: document?.schemaVersion ?? null,
            worldRevision: document?.worldRevision ?? null, changedArchive }));
        }
        return Object.freeze(result);
      });
    },
    exportMigrationOriginal(slot, key, signal) {
      if (!validSlot(slot) || typeof key !== 'string') return Promise.resolve({ ok: false, code: 'invalid_slot' });
      return bounded(signal, async active => {
        const originals = await originalTexts(slot, active), item = originals.find(o => o.key === key);
        if (!item) throw new StorageFailure('original_unavailable');
        await rawDigest(item.text); guard(active);
        let document = null; try { document = await decodeSave(item.text); } catch (error) { if (!(error instanceof SaveFormatError)) throw error; }
        guard(active);
        return Object.freeze({ slotId: slot, token: key, text: item.text, kind: document ? 'valid' as const : 'original' as const,
          ...(document ? { worldRevision: document.worldRevision, schemaVersion:document.schemaVersion } : {}) });
      });
    },
    inspectPrevious(slot, signal) {
      if (!validSlot(slot)) return Promise.resolve({ ok: false, code: 'invalid_slot' });
      return bounded(signal, async active => {
        const connection = await open(active, false);
        let captured: { token: string; previousToken: string; currentText: string; previousText: string };
        try {
          captured = await transaction(connection, 'readonly', active, (tx, done, fail) => {
            const heads = tx.objectStore('heads'), count = heads.count(slot);
            count.onsuccess = () => {
              if (!count.result) { fail('empty'); return; }
              const found = heads.get(slot);
              found.onsuccess = () => {
                let head: Head | null;
                try { head = checkedHead(found.result); } catch { fail('invalid_format'); return; }
                if (!head) { fail('invalid_format'); return; }
                if (!head.previousToken) { fail('no_previous'); return; }
                const result = { token: head.token, previousToken: head.previousToken, currentText: '', previousText: '' };
                const current = tx.objectStore('snapshots').get(head.token), previous = tx.objectStore('snapshots').get(head.previousToken);
                current.onsuccess = () => { if (typeof current.result !== 'string') fail('missing_snapshot'); else result.currentText = current.result; };
                previous.onsuccess = () => { if (typeof previous.result !== 'string') fail('previous_invalid'); else result.previousText = previous.result; };
                done(result);
              };
            };
          });
        } finally { connection.close(); }
        guard(active);
        const documents = await recoveryDocuments(captured.currentText, captured.previousText); guard(active);
        return Object.freeze({ ...captured, ...documents });
      });
    },
    async recoverPrevious(request) {
      if (!request || !validSlot(request.slotId)) return { ok: false, code: 'invalid_slot' };
      let submitted = false;
      const result = await bounded(request.signal, async active => {
        const expected = checkedHead({ token: request.expectedToken, previousToken: request.expectedPreviousToken });
        if (!expected?.previousToken || typeof request.expectedCurrentText !== 'string' || typeof request.expectedPreviousText !== 'string') throw new StorageFailure('invalid_format');
        const documents = await recoveryDocuments(request.expectedCurrentText, request.expectedPreviousText); guard(active);
        const connection = await open(active, false), token = crypto.randomUUID();
        try {
          submitted = true;
          return await transaction<SlotContents>(connection, 'readwrite', active, (tx, done, fail) => {
            const heads = tx.objectStore('heads'), snapshots = tx.objectStore('snapshots'), found = heads.get(request.slotId);
            found.onsuccess = () => {
              let head: Head | null;
              try { head = checkedHead(found.result); } catch { fail('conflict'); return; }
              if (!head || head.token !== expected.token || head.previousToken !== expected.previousToken) { fail('conflict'); return; }
              const current = snapshots.get(head.token);
              current.onsuccess = () => {
                if (current.result !== request.expectedCurrentText) { fail('conflict'); return; }
                const previous = snapshots.get(expected.previousToken!);
                previous.onsuccess = () => {
                  if (previous.result !== request.expectedPreviousText) { fail('conflict'); return; }
                  try {
                    snapshots.add(request.expectedPreviousText, token);
                    heads.put({ token, previousToken: head.token }, request.slotId);
                    done(Object.freeze({ token, document: documents.previousDocument, previous: documents.currentDocument,
                      ...(documents.currentIssue ? { backupWarning: 'invalid_backup' as const } : {}) }));
                  } catch (error) { fail(error instanceof DOMException && error.name === 'QuotaExceededError' ? 'quota_exceeded' : 'storage_error'); }
                };
              };
            };
          });
        } finally { connection.close(); }
      });
      if (!result.ok && submitted && ['timeout', 'cancelled'].includes(result.code)) return { ok: false, code: 'outcome_unknown' };
      return result;
    },
    inspectImportTarget(slot, signal) {
      if (!validSlot(slot)) return Promise.resolve({ ok: false, code: 'invalid_slot' });
      return bounded(signal, async active => {
        const connection = await open(active);
        let captured: { head: Head | null; text: string | null };
        try {
          captured = await transaction(connection, 'readonly', active, (tx, done, fail) => {
            const heads = tx.objectStore('heads'), count = heads.count(slot);
            count.onsuccess = () => {
              if (!count.result) { done({ head: null, text: null }); return; }
              const request = heads.get(slot);
              request.onsuccess = () => {
                try {
                  const head = checkedHead(request.result);
                  if (!head) { fail('invalid_format'); return; }
                  const body = tx.objectStore('snapshots').get(head.token);
                  body.onsuccess = () => {
                    if (typeof body.result !== 'string') { fail('missing_snapshot'); return; }
                    done({ head, text: body.result });
                  };
                } catch { fail('invalid_format'); }
              };
            };
          });
        } finally { connection.close(); }
        guard(active);
        if (!captured.head) return { kind: 'empty' as const };
        const document = await decodeSave(captured.text!); guard(active);
        return Object.freeze({ kind: 'replace' as const, ...captured.head, text: captured.text!, document });
      });
    },
    async replaceImported(text, request) {
      if (!request || !validSlot(request.slotId)) return { ok: false, code: 'invalid_slot' };
      let submitted = false;
      const result = await bounded(request.signal, async active => {
        const expected = checkedHead({ token: request.expectedToken, previousToken: request.expectedPreviousToken });
        if (!expected || typeof request.expectedText !== 'string') throw new StorageFailure('invalid_format');
        const previous = await decodeSave(request.expectedText), document = await importDocument(text); guard(active);
        if (previous.schemaVersion !== document.schemaVersion) throw new StorageFailure(document.schemaVersion === 1 ? 'downgrade_refused' : 'migration_required');
        const connection = await open(active), token = crypto.randomUUID();
        try {
          submitted = true;
          return await transaction<SlotContents>(connection, 'readwrite', active, (tx, done, fail) => {
            const heads = tx.objectStore('heads'), snapshots = tx.objectStore('snapshots'), current = heads.get(request.slotId);
            current.onsuccess = () => {
              let head: Head | null;
              try { head = checkedHead(current.result); } catch { fail('conflict'); return; }
              if (!head || head.token !== expected.token || head.previousToken !== expected.previousToken) { fail('conflict'); return; }
              const body = snapshots.get(head.token);
              body.onsuccess = () => {
                if (body.result !== request.expectedText) { fail('conflict'); return; }
                try {
                  snapshots.add(text, token);
                  heads.put({ token, previousToken: head.token }, request.slotId);
                  // File replacement never deletes snapshots, even old/invalid/shared backups.
                  done(Object.freeze({ token, document, previous }));
                } catch (error) { fail(error instanceof DOMException && error.name === 'QuotaExceededError' ? 'quota_exceeded' : 'storage_error'); }
              };
            };
          });
        } finally { connection.close(); }
      });
      if (!result.ok && submitted && ['timeout', 'cancelled'].includes(result.code)) return { ok: false, code: 'outcome_unknown' };
      return result;
    },
    async importEmpty(text, slot, signal) {
      if (!validSlot(slot)) return { ok: false, code: 'invalid_slot' };
      let submitted = false;
      const result = await bounded(signal, async active => {
        const document = await importDocument(text); guard(active);
        const connection = await open(active), token = crypto.randomUUID();
        try {
          submitted = true;
          return await transaction<SlotContents>(connection, 'readwrite', active, (tx, done, fail) => {
            const heads = tx.objectStore('heads'), exists = heads.count(slot);
            exists.onsuccess = () => {
              if (exists.result !== 0) { fail('occupied'); return; }
              try {
                tx.objectStore('snapshots').add(text, token);
                heads.add({ token, previousToken: null }, slot);
                done(Object.freeze({ token, document, previous: null }));
              } catch (error) { fail(error instanceof DOMException && error.name === 'QuotaExceededError' ? 'quota_exceeded' : 'storage_error'); }
            };
          });
        } finally { connection.close(); }
      });
      // A cancellation can race the completed transaction event. Never claim the DB is unchanged.
      if (!result.ok && submitted && ['timeout', 'cancelled'].includes(result.code)) return { ok: false, code: 'outcome_unknown' };
      return result;
    },
    exportCurrent(slot: ManualSlotId, signal?: AbortSignal) {
      if (!validSlot(slot)) return Promise.resolve({ ok: false as const, code: 'invalid_slot' });
      return bounded(signal, async active => {
        const connection = await open(active, false);
        let snapshot: { token: string; text: string };
        try {
          snapshot = await transaction(connection, 'readonly', active, (tx, done, fail) => {
            const head = tx.objectStore('heads').get(slot);
            head.onsuccess = () => {
              try {
                const current = checkedHead(head.result);
                if (!current) { fail('empty'); return; }
                const body = tx.objectStore('snapshots').get(current.token);
                body.onsuccess = () => {
                  if (body.result === undefined) { fail('missing_snapshot'); return; }
                  if (typeof body.result !== 'string') { fail('non_text'); return; }
                  done({ token: current.token, text: body.result });
                };
              } catch { fail('invalid_format'); }
            };
          });
        } finally { connection.close(); }
        guard(active);
        const text = snapshot.text;
        if (new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(new TextEncoder().encode(text)) !== text) throw new StorageFailure('invalid_utf8');
        try {
          const document = await decodeSave(text); guard(active);
          return Object.freeze({ slotId: slot, ...snapshot, kind: 'valid' as const, worldRevision: document.worldRevision, schemaVersion:document.schemaVersion });
        } catch (error) {
          guard(active);
          if (!(error instanceof SaveFormatError)) throw error;
          return Object.freeze({ slotId: slot, ...snapshot, kind: 'original' as const });
        }
      });
    },
    readExisting: (slot, signal?: AbortSignal) => validSlot(slot) ? bounded(signal, async active => validated(await readRaw(slot, active, false)))
      : Promise.resolve({ ok: false, code: 'invalid_slot' }),
    read: (slot, signal?: AbortSignal) => validSlot(slot) ? bounded(signal, async active => validated(await readRaw(slot, active)))
      : Promise.resolve({ ok: false, code: 'invalid_slot' }),
    write: (world, request) => {
      const descriptor = request && typeof request === 'object' ? Object.getOwnPropertyDescriptor(request, 'slotId') : undefined;
      if (!descriptor || !('value' in descriptor) || !validSlot(descriptor.value)) return Promise.resolve({ ok: false, code: 'invalid_slot' });
      const slot = descriptor.value;
      return bounded(request.signal, async active => {
      const raw = await readRaw(slot, active), previous = await validated(raw);
      guard(active);
      if (previous.token !== request.expectedToken) throw new StorageFailure('conflict');
      const encoded = await encodeSave(world, { gameBuild: world.stateSchema === 'g2-world-v2' ? 'g2-010' : 'g2-002', savedAtUtc: new Date().toISOString() });
      const document = await decodeSave(encoded);
      guard(active);
      if (previous.document) {
        if (previous.document.schemaVersion !== document.schemaVersion) throw new StorageFailure(document.schemaVersion === 1 ? 'downgrade_refused' : 'migration_required');
        if (previous.document.saveId !== document.saveId && !request.allowReplaceWorld) throw new StorageFailure('confirmation_required');
        if (previous.document.saveId === document.saveId
          && (previous.document.worldRevision > document.worldRevision || (previous.document.worldRevision === document.worldRevision
            && canonicalJSON(previous.document.worldState) !== canonicalJSON(document.worldState)))) throw new StorageFailure('stale_revision');
      }
      const token = crypto.randomUUID();
      const connection = await open(active);
      try {
        return await transaction<SlotContents>(connection, 'readwrite', active, (tx, done, fail) => {
          const heads = tx.objectStore('heads'), snapshots = tx.objectStore('snapshots'), current = heads.get(slot);
          current.onsuccess = () => {
            try {
              const head = checkedHead(current.result);
              if ((head?.token ?? null) !== request.expectedToken) { fail('conflict'); return; }
              snapshots.put(encoded, token);
              heads.put({ token, previousToken: head?.token ?? null }, slot);
              // Preserve damaged backup bytes for future recovery/export tooling.
              if (head?.previousToken && !previous.backupWarning && previous.previous?.schemaVersion === document.schemaVersion) {
                const candidate = head.previousToken, references = heads.getAll();
                references.onsuccess = () => {
                  // A malformed head is not proof that its referenced data is disposable.
                  const retained = references.result.some(input => {
                    try { const ref = checkedHead(input); return ref?.token === candidate || ref?.previousToken === candidate; }
                    catch { return true; }
                  });
                  if (!retained && !candidate.startsWith('migration-')) snapshots.delete(candidate);
                };
              }
              done(Object.freeze({ token, document, previous: previous.document }));
            } catch (error) { fail(error instanceof DOMException && error.name === 'QuotaExceededError' ? 'quota_exceeded' : 'storage_error'); }
          };
        });
      } finally { connection.close(); }
    }); },
  });
}
