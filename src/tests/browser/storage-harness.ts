import { createIndexedDbStorage } from '../../adapters/storage/indexed-db';
import { decodeSave } from '../../adapters/storage/save-format';
import { createEngine } from '../../core/engine';
import initial from '../lifecycle-snapshots/initial-dead.json';
import type { ManualSaveStore, SaveResult, SlotContents } from '../../adapters/storage/port';

function check(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
function value<T>(result: SaveResult<T>): T { if (!result.ok) throw Error(result.code); return result.value; }
const a = createEngine(initial).snapshot();
function advance(world = a, id = 'cmd-disk-1') {
  const engine = createEngine(world);
  const result = engine.dispatch({ commandId: id, actorId: world.player.playerId, source: 'button', verb: 'observe', targetIds: [], toolIds: [], arguments: {}, utterance: '', expectedWorldRevision: world.campaign.worldRevision });
  check(result.ok, 'advance must commit'); return engine.snapshot();
}
const b = advance();
const settings = (expectedToken: string | null, allowReplaceWorld = false) => ({ slotId: 'manual-1' as const, expectedToken, allowReplaceWorld });
function db(name: string, version = 1): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => { const r = indexedDB.open(name, version); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}
async function raw(name: string) {
  const conn = await db(name);
  try {
    return await new Promise<{ heads: unknown[]; snapshots: unknown[] }>((resolve, reject) => {
      const tx = conn.transaction(['heads', 'snapshots']); const heads = tx.objectStore('heads').getAll(), snapshots = tx.objectStore('snapshots').getAll();
      tx.oncomplete = () => resolve({ heads: heads.result, snapshots: snapshots.result }); tx.onabort = () => reject(tx.error);
    });
  } finally { conn.close(); }
}
export async function runStorageChecks(prefix: string) {
  const passed: string[] = [];
  const name = `${prefix}-atomic`, store = createIndexedDbStorage({ databaseName: name });
  check(value(await store.read('manual-1')).document === null, 'empty slot');
  const first = value(await store.write(a, settings(null)));
  check(first.document?.worldRevision === 0 && first.token, 'A stored only after commit');
  const before = await raw(name);
  // The backup must not become a dependency of an intact current save.
  const backupName = `${prefix}-bad-backup`, backupStore = createIndexedDbStorage({ databaseName: backupName });
  const ba = value(await backupStore.write(a, settings(null))), bb = value(await backupStore.write(b, settings(ba.token)));
  const backupDb = await db(backupName);
  await new Promise<void>((resolve, reject) => {
    const tx = backupDb.transaction('snapshots', 'readwrite'); tx.objectStore('snapshots').put('{broken-backup', ba.token!);
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
  }); backupDb.close();
  const backupBytes = await raw(backupName), intact = value(await backupStore.read('manual-1'));
  check(intact.document?.worldRevision === 1 && intact.backupWarning === 'invalid_backup', 'valid B loads with explicit backup warning');
  check(JSON.stringify(await raw(backupName)) === JSON.stringify(backupBytes), 'read does not repair/delete bad backup');
  const bc = value(await backupStore.write(advance(b, 'cmd-after-bad-backup'), settings(bb.token)));
  check(bc.document?.worldRevision === 2 && bc.previous?.worldRevision === 1, 'next save retains valid B backup');
  check((await raw(backupName)).snapshots.includes('{broken-backup'), 'bad backup original retained separately on subsequent write');
  passed.push('valid current survives corrupt previous; read unchanged and subsequent save preserves original');
  for (const fault of ['abort', 'quota', 'cancel'] as const) {
    const cancellation = new AbortController();
    const old = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'heads' && fault === 'quota') throw new DOMException('Injected quota', 'QuotaExceededError');
      const request = old.apply(this, args);
      if (this.name === 'snapshots' && fault === 'abort') request.addEventListener('success', () => this.transaction.abort(), { once: true });
      if (this.name === 'snapshots' && fault === 'cancel') request.addEventListener('success', () => cancellation.abort(), { once: true });
      return request;
    };
    let result;
    try { result = await store.write(b, { ...settings(first.token), signal: cancellation.signal }); } finally { IDBObjectStore.prototype.put = old; }
    check(!result.ok, `${fault} cannot report success`);
    check(JSON.stringify(await raw(name)) === JSON.stringify(before), `${fault} must retain all bytes and head`);
    const reopened = value(await createIndexedDbStorage({ databaseName: name }).read('manual-1'));
    check(JSON.stringify(reopened.document?.worldState) === JSON.stringify(first.document?.worldState), `${fault} reopens A`);
    passed.push(`${fault}: actual transaction failure retains A`);
  }
  const second = value(await store.write(b, settings(first.token)));
  check(second.document?.worldRevision === 1 && second.previous?.worldRevision === 0, 'B plus backup A');
  check(value(await store.read('manual-1')).token === second.token, 'reopen B');
  check(!(await store.write(a, settings(second.token))).ok, 'reject old revision');
  const fork = createEngine({ ...b, player: { ...b.player, background: 'conflicting same revision' } }).snapshot();
  check(!(await store.write(fork, settings(second.token))).ok, 'reject equal revision with conflicting facts');
  check(!(await store.write(advance(b, 'cmd-disk-2'), settings(first.token))).ok, 'reject stale token');
  const other = createEngine({ ...a, campaign: { ...a.campaign, saveId: 'other-world' } }).snapshot();
  check(!(await store.write(other, settings(second.token))).ok, 'different world requires confirmation');
  const replaced = value(await store.write(other, settings(second.token, true)));
  check(replaced.document?.saveId === 'other-world' && replaced.previous?.saveId === a.campaign.saveId, 'confirmed world replacement retains prior world');
  passed.push('success, backup, stale revision/token, confirmed world replacement');
  const token = replaced.token!;
  const conn = await db(name);
  await new Promise<void>((resolve, reject) => {
    const tx = conn.transaction('snapshots', 'readwrite'); tx.objectStore('snapshots').put('{broken', token);
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
  }); conn.close();
  const damaged = await raw(name);
  check(!(await store.read('manual-1')).ok, 'corrupt current rejected');
  check(!(await store.write(b, settings(token, true))).ok, 'corrupt slot cannot overwrite');
  check(JSON.stringify(damaged) === JSON.stringify(await raw(name)), 'corrupt bytes preserved');
  const backup = damaged.snapshots.filter(s => typeof s === 'string' && s !== '{broken')[0] as string;
  check((await decodeSave(backup)).worldRevision === 1, 'previous B remains recoverable');
  passed.push('corruption rejects read/write without deleting recoverable backup');
  const cancelled = new AbortController(); cancelled.abort();
  check(!(await store.write(b, { ...settings(token), signal: cancelled.signal })).ok, 'pre-aborted write');
  const denied = new Proxy(indexedDB, { get(target, key) { if (key === 'open') return () => { throw new DOMException('denied', 'SecurityError'); }; const v = Reflect.get(target, key); return typeof v === 'function' ? v.bind(target) : v; } });
  check(!(await createIndexedDbStorage({ factory: denied, databaseName: name }).read('manual-1')).ok, 'denied open returns failure');
  passed.push('cancelled and SecurityError return failure');
  // Real queued-open timeout behind a blocked upgrade; no simulated durability here.
  const blockedName = `${prefix}-blocked`, blockedStore = createIndexedDbStorage({ databaseName: blockedName, timeoutMs: 50 });
  value(await blockedStore.write(a, settings(null)));
  const holding = await db(blockedName);
  const upgrade = indexedDB.open(blockedName, 2);
  await new Promise<void>(resolve => { upgrade.onblocked = () => resolve(); });
  const queued = await blockedStore.read('manual-1'); check(!queued.ok && queued.code === 'timeout', 'blocked queue bounded');
  const upgraded = new Promise<IDBDatabase>((resolve, reject) => { upgrade.onsuccess = () => resolve(upgrade.result); upgrade.onerror = () => reject(upgrade.error); });
  holding.close(); const upgradedConn = await upgraded; upgradedConn.close();
  const v2 = await db(blockedName, 2);
  const retained = await new Promise<string>(resolve => { const tx = v2.transaction('snapshots'); const r = tx.objectStore('snapshots').getAll(); tx.oncomplete = () => resolve(r.result[0]); });
  v2.close(); check((await decodeSave(retained)).worldRevision === 0, 'timed out old open cannot change A');
  passed.push('real blocked upgrade queue times out, late open does not write');
  return passed;
}

let raceStore: ManualSaveStore;
let raceSlot: SlotContents;
export async function prepareRace(name: string) {
  raceStore = createIndexedDbStorage({ databaseName: name }); raceSlot = value(await raceStore.read('manual-1'));
  return raceSlot.token;
}
export async function writeRace() { return raceStore.write(a, settings(raceSlot.token)); }
