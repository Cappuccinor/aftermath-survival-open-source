import { createIndexedDbStorage } from '../../adapters/storage/indexed-db';
import { decodeSave, encodeSave } from '../../adapters/storage/save-format';
import { createEngine } from '../../core/engine';
import type { SaveResult } from '../../adapters/storage/port';
function check(x: unknown, label: string): asserts x { if (!x) throw Error(label); }
const value = <T>(r: SaveResult<T>): T => { if (!r.ok) throw Error(r.code); return r.value; };
function open(name: string) { return new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open(name, 1); r.onupgradeneeded = () => { r.result.createObjectStore('heads'); r.result.createObjectStore('snapshots'); }; r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }
async function edit(name: string, f: (tx: IDBTransaction) => void) { const db = await open(name); try { await new Promise<void>((resolve, reject) => { const tx = db.transaction(['heads', 'snapshots'], 'readwrite'); f(tx); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); } finally { db.close(); } }
async function raw(name: string) { const db = await open(name); try { return await new Promise<string>((resolve, reject) => { const tx = db.transaction(['heads', 'snapshots']); const rs = ['heads', 'snapshots'].flatMap(s => [tx.objectStore(s).getAllKeys(), tx.objectStore(s).getAll()]); tx.oncomplete = () => resolve(JSON.stringify(rs.map(r => r.result))); tx.onabort = () => reject(tx.error); }); } finally { db.close(); } }
export async function runExportChecks(fixtureText: string) {
  const name = 'g2-004-export', store = createIndexedDbStorage({ databaseName: name }), checks: string[] = [];
  const healthy = '\n' + fixtureText + '\n', fixture = await decodeSave(healthy);
  for (const id of ['manual-1', 'manual-2', 'manual-3'] as const) {
    const w = createEngine({ ...fixture.worldState, campaign: { ...fixture.worldState.campaign, saveId: id } }).snapshot();
    value(await store.write(w, { slotId: id, expectedToken: null, allowReplaceWorld: false }));
  }
  await edit(name, tx => { tx.objectStore('heads').put({ token: 'original-v1', previousToken: 'bad-backup' }, 'manual-1'); tx.objectStore('snapshots').put(healthy, 'original-v1'); tx.objectStore('snapshots').put('{bad previous', 'bad-backup'); });
  const before = await raw(name), exported = value(await store.exportCurrent!('manual-1'));
  check(exported.text === healthy && exported.token === 'original-v1' && exported.kind === 'valid', 'exact original v1, not re-encoded; bad previous ignored');
  check(JSON.stringify(createEngine((await decodeSave(exported.text)).worldState).snapshot()) === JSON.stringify(fixture.worldState), 'whole world preserved');
  for (const id of ['manual-2', 'manual-3'] as const) check(value(await store.exportCurrent!(id)).kind === 'valid', 'other slots healthy');
  check(await raw(name) === before, 'healthy exports zero writes'); checks.push('formal v1 whitespace bytes/full world and three independent slots; corrupt previous does not block; zero writes');
  for (const text of ['{broken <script>no execution</script> 中文😀', JSON.stringify({ ...JSON.parse(healthy), checksums: { state: '0'.repeat(64) } }), JSON.stringify({ ...JSON.parse(healthy), schemaVersion: 999 }), '\uFEFF' + healthy, '']) {
    await edit(name, tx => tx.objectStore('snapshots').put(text, 'original-v1')); const bytes = await raw(name);
    const r = value(await store.exportCurrent!('manual-1')); check(r.kind === 'original' && r.text === text, 'bad/future/BOM/empty raw text untouched'); check(await raw(name) === bytes, 'original export zero writes');
  }
  checks.push('broken JSON/checksum/future/BOM/empty and nonBMP raw text preserved byte-for-byte, never repaired');
  for (const data of [42, { value: 'unknown' }, undefined, '\uD800bad']) {
    await edit(name, tx => { if (data === undefined) tx.objectStore('snapshots').delete('original-v1'); else tx.objectStore('snapshots').put(data, 'original-v1'); });
    const bytes = await raw(name); check(!(await store.exportCurrent!('manual-1')).ok, 'nontext/missing/unpaired surrogate reject'); check(await raw(name) === bytes, 'bad data retained');
  }
  await edit(name, tx => tx.objectStore('heads').put({ token: 42 }, 'manual-1')); let bytes = await raw(name); check(!(await store.exportCurrent!('manual-1')).ok, 'malformed head reject'); check(await raw(name) === bytes, 'bad head retained');
  await edit(name, tx => tx.objectStore('heads').delete('manual-1')); bytes = await raw(name); const absent = await store.exportCurrent!('manual-1'); check(!absent.ok && absent.code === 'empty', 'missing head empty'); check(await raw(name) === bytes, 'empty no repair');
  checks.push('nontext/missing snapshot/malformed head/unpaired surrogate rejected without replacement or deletion');
  const invalid = await store.exportCurrent!('manual-4' as 'manual-1'); check(!invalid.ok && invalid.code === 'invalid_slot', 'strict slot');
  const cancel = new AbortController(); cancel.abort(); const cancelled = await store.exportCurrent!('manual-2', cancel.signal); check(!cancelled.ok && cancelled.code === 'cancelled', 'cancelled bounded');
  const unavailable = createIndexedDbStorage({ factory: { open() { throw new DOMException('denied', 'SecurityError'); } } as unknown as IDBFactory }); check(!(await unavailable.exportCurrent!('manual-1')).ok, 'unavailable error');
  checks.push('invalid identity/cancelled/SecurityError cannot yield file material');
  await edit(name, tx => { tx.objectStore('heads').put({ token: 'race-old', previousToken: null }, 'manual-1'); tx.objectStore('snapshots').put(healthy, 'race-old'); });
  const newer = await encodeSave(createEngine({ ...fixture.worldState, campaign: { ...fixture.worldState.campaign, saveId: 'race-new' } }).snapshot(), { gameBuild: 'test', savedAtUtc: '2026-10-25T00:00:00.000Z' });
  const reading = store.exportCurrent!('manual-1');
  await edit(name, tx => { tx.objectStore('snapshots').put(newer, 'race-new'); tx.objectStore('heads').put({ token: 'race-new', previousToken: null }, 'manual-1'); });
  const race = value(await reading); check((race.token === 'race-old' && race.text === healthy) || (race.token === 'race-new' && race.text === newer), 'consistent head+text during concurrent update');
  checks.push('readonly head/current snapshot remains self-consistent across concurrent writer');
  const blocker = await open('g2-004-export-blocked'); const upgrading = indexedDB.open('g2-004-export-blocked', 2);
  const upgradeDone = new Promise<void>((resolve, reject) => { upgrading.onsuccess = () => { upgrading.result.close(); resolve(); }; upgrading.onerror = () => reject(upgrading.error); });
  const short = createIndexedDbStorage({ databaseName: 'g2-004-export-blocked', timeoutMs: 20 });
  const timed = await short.exportCurrent!('manual-1'); check(!timed.ok && timed.code === 'timeout', 'blocked open bounded'); blocker.close(); await upgradeDone;
  checks.push('real blocked upgrade queue export times out; late open cannot change data');
  return checks;
}
