import { createIndexedDbStorage } from '../../adapters/storage/indexed-db';
import { decodeSaveVersioned, encodeSaveVersioned } from '../../adapters/storage/save-versions';
import { rawDigest } from '../../adapters/storage/migration';
import { createContactPrototype } from '../../core/contact-prototype';
import type { MigrationTarget, SaveResult } from '../../adapters/storage/port';
import type { ManualSlotId } from '../../application/ports';
function check(value: unknown, label: string): asserts value { if (!value) throw Error(label); }
const value = <T>(r: SaveResult<T>): T => { if (!r.ok) throw Error(r.code); return r.value; };
const slots = ['manual-1', 'manual-2', 'manual-3'] as const;
function open(name: string) { return new Promise<IDBDatabase>((resolve, reject) => {
  const r = indexedDB.open(name, 1); r.onupgradeneeded = () => { r.result.createObjectStore('heads'); r.result.createObjectStore('snapshots'); };
  r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
}); }
async function edit(name: string, f: (tx: IDBTransaction) => void) { const db = await open(name); try {
  await new Promise<void>((resolve, reject) => { const tx = db.transaction(['heads', 'snapshots'], 'readwrite'); f(tx); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
} finally { db.close(); } }
async function raw(name: string) { const db = await open(name); try { return await new Promise<string>((resolve, reject) => {
  const tx = db.transaction(['heads', 'snapshots']); const rs = ['heads', 'snapshots'].flatMap(s => [tx.objectStore(s).getAllKeys(), tx.objectStore(s).getAll()]);
  tx.oncomplete = () => resolve(JSON.stringify(rs.map(r => r.result))); tx.onabort = () => reject(tx.error);
}); } finally { db.close(); } }
export async function seedMigrationRace(name: string, text: string, previous: unknown = '\n' + text + '\n') {
  await edit(name, tx => { for (const slot of slots) {
    tx.objectStore('heads').add({ token: `${slot}-current`, previousToken: `${slot}-previous` }, slot);
    tx.objectStore('snapshots').add(text, `${slot}-current`); tx.objectStore('snapshots').add(previous, `${slot}-previous`);
  } tx.objectStore('snapshots').add('unrelated-original', 'orphan'); });
}
export const migrationRequest = (t: MigrationTarget, signal?: AbortSignal) => ({ slotId: t.slotId,
  expectedToken: t.token, expectedPreviousToken: t.previousToken, expectedCurrentText: t.currentText,
  expectedPreviousText: t.previousText, candidateText: t.candidate.text, ...(signal ? { signal } : {}) });
function retained(before: string, after: string) { const a = JSON.parse(before), b = JSON.parse(after);
  for (let n = 0; n < a[2].length; n++) check(JSON.stringify(a[3][n]) === JSON.stringify(b[3][b[2].indexOf(a[2][n])]), `old bytes retained ${a[2][n]}`);
}
export async function runMigrationChecks(text: string) {
  const checks: string[] = [], name = 'g2-010-migration', store = createIndexedDbStorage({ databaseName: name });
  check(typeof store.inspectMigration === 'function' && typeof store.commitMigration === 'function', 'migration capability exists');
  await seedMigrationRace(name, text);
  for (const slot of slots) {
    const before = await raw(name), target = value(await store.inspectMigration!(slot));
    check(await raw(name) === before, 'preview readonly'); const converted = value(await store.commitMigration!(migrationRequest(target)));
    retained(before, await raw(name)); check(converted.document?.schemaVersion === 2, 'v2 current');
    check(converted.previous?.schemaVersion === 1, 'old current previous');
    for (const other of slots.filter(s => s !== slot)) {
      const a = JSON.parse(before), b = JSON.parse(await raw(name)); check(JSON.stringify(a[1][a[0].indexOf(other)]) === JSON.stringify(b[1][b[0].indexOf(other)]), 'other full slot head intact');
    }
    const originals = value(await store.listMigrationOriginals!(slot)); check(originals.filter(o => o.source === 'archive').length === 2, 'both raw originals pinned');
    for (const o of originals.filter(o => o.source === 'archive')) {
      const exported = value(await store.exportMigrationOriginal!(slot, o.key)); check(exported.text === text || exported.text === '\n' + text + '\n', 'exact archived raw');
    }
    const mixed = await store.inspectPrevious!(slot); check(!mixed.ok && mixed.code === 'cross_version_recovery_required', 'mixed recovery explicitly refused');
    const oldPrevious = originals.find(o => o.source === 'previous')!; check(value(await store.exportMigrationOriginal!(slot, oldPrevious.key)).text === text, 'mixed previous still exportable');
    const already = await store.inspectMigration!(slot); check(!already.ok && already.code === 'already_current', 'repeat migration no write');
    let current = converted; for (let n = 0; n < 3; n++) current = value(await store.write(converted.document!.worldState, { slotId: slot, expectedToken: current.token, allowReplaceWorld: false }));
    const after = value(await store.listMigrationOriginals!(slot)); check(after.filter(o => o.source === 'archive').length === 2, 'normal rotation retains originals');
    for (const o of after.filter(o => o.source === 'archive')) check(value(await store.exportMigrationOriginal!(slot, o.key)).text === (o.key === `migration-original:${await rawDigest(text)}` ? text : '\n' + text + '\n'), 'rotation exact bytes');
    const same = value(await store.inspectPrevious!(slot)); value(await store.recoverPrevious!({ slotId: slot, expectedToken: same.token, expectedPreviousToken: same.previousToken, expectedCurrentText: same.currentText, expectedPreviousText: same.previousText }));
  }
  checks.push('three full slots upgrade separately; read-only preview; old snapshots/orphans exact; current/previous permanent originals; repeat no-op; rotation and same-version recovery');
  for (const change of ['current', 'previous', 'token', 'previousToken', 'missing']) {
    const n = name + '-race-' + change; await seedMigrationRace(n, text); const s = createIndexedDbStorage({ databaseName: n }), t = value(await s.inspectMigration!('manual-1'));
    await edit(n, tx => { if (change === 'current' || change === 'previous') tx.objectStore('snapshots').put('changed', change === 'current' ? t.token : t.previousToken!);
      else if (change === 'missing') tx.objectStore('heads').delete('manual-1');
      else tx.objectStore('heads').put({ token: change === 'token' ? 'new' : t.token, previousToken: change === 'previousToken' ? 'new' : t.previousToken }, 'manual-1'); });
    const before = await raw(n), r = await s.commitMigration!(migrationRequest(t)); check(!r.ok && r.code === 'conflict', 'full raw/head conflict ' + change); check(await raw(n) === before, 'conflict zero writes');
  }
  checks.push('same-token current/previous text and both head-token/remove CAS conflicts preserve all bytes');
  for (const previous of ['{damaged', JSON.stringify({ format: 'aftermath-save', schemaVersion: 99 }), await encodeSaveVersioned(createContactPrototype(), { gameBuild: 'fixture-v2', savedAtUtc: '2026-10-26T00:00:00.000Z' })]) {
    const n = name + '-mixed-' + checks.length; await seedMigrationRace(n, text, previous); const s = createIndexedDbStorage({ databaseName: n });
    const t = value(await s.inspectMigration!('manual-1')), before = await raw(n); value(await s.commitMigration!(migrationRequest(t))); retained(before, await raw(n));
    check(value(await s.exportMigrationOriginal!('manual-1', `migration-original:${await rawDigest(previous)}`)).text === previous, 'mixed/damaged backup archived without interpretation'); checks.push('raw previous preserved: ' + (previous.startsWith('{damaged') ? 'damaged' : JSON.parse(previous).schemaVersion));
  }
  for (const mode of ['missing', 'non-text', 'collision', 'candidate']) {
    const n = name + '-invalid-' + mode; await seedMigrationRace(n, text); const s = createIndexedDbStorage({ databaseName: n }), t = value(await s.inspectMigration!('manual-1'));
    if (mode === 'missing' || mode === 'non-text') {
      await edit(n, tx => mode === 'missing' ? tx.objectStore('snapshots').delete(t.previousToken!) : tx.objectStore('snapshots').put({ broken: true }, t.previousToken!));
      const before = await raw(n); check(!(await s.inspectMigration!('manual-1')).ok, 'missing/nontext previous refused'); check(await raw(n) === before, 'invalid previous unchanged');
    } else {
      if (mode === 'collision') await edit(n, tx => tx.objectStore('snapshots').add('wrong raw at archive key', `migration-original:${t.candidate.sourceHash}`));
      const before = await raw(n), request = migrationRequest(t); if (mode === 'candidate') request.candidateText = await encodeSaveVersioned(createContactPrototype(), { gameBuild: 'different', savedAtUtc: '2026-10-26T00:00:00.000Z' });
      check(!(await s.commitMigration!(request)).ok, 'collision/forged candidate refused'); check(await raw(n) === before, 'invalid operation rollback exact');
    }
  }
  checks.push('missing/nontext backup, archive collision and unrelated candidate rejected without loss');
  for (const mode of ['abort', 'quota', 'cancel', 'timeout'] as const) {
    const n = name + '-fault-' + mode; await seedMigrationRace(n, text); const s = createIndexedDbStorage({ databaseName: n, timeoutMs: mode === 'timeout' ? 100 : 4000 });
    const t = value(await s.inspectMigration!('manual-1')), before = await raw(n), controller = new AbortController(), original = IDBObjectStore.prototype.add; let fired = false;
    IDBObjectStore.prototype.add = function(...args: Parameters<IDBObjectStore['add']>) {
      const r = original.apply(this, args); if (this.name === 'snapshots' && this.transaction.db.name === n && !fired) {
        fired = true; const tx = this.transaction; r.addEventListener('success', () => {
          if (mode === 'timeout') { const keep = () => { try { const q = tx.objectStore('snapshots').get('keep'); q.onsuccess = keep; } catch {} }; keep(); }
          else if (mode === 'cancel') controller.abort(); else { tx.abort(); if (mode === 'quota') Object.defineProperty(tx, 'error', { value: new DOMException('injected quota', 'QuotaExceededError') }); }
        });
      } return r;
    };
    try { const r = await s.commitMigration!(migrationRequest(t, controller.signal)); check(!r.ok && fired, 'actual transaction fault'); check(await raw(n) === before, 'archive and head atomic rollback');
      if (mode === 'quota') check(r.code === 'quota_exceeded', 'quota category');
    } finally { IDBObjectStore.prototype.add = original; }
  }
  checks.push('actual archive add success then abort/quota/cancel/timeout: no partial originals, head or snapshot');
  const boundary = name + '-boundary'; await seedMigrationRace(boundary, text); const b = createIndexedDbStorage({ databaseName: boundary }), t = value(await b.inspectMigration!('manual-1'));
  const controller = new AbortController(), transaction = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function(...args: Parameters<IDBDatabase['transaction']>) { const tx = transaction.apply(this, args); if (this.name === boundary && args[1] === 'readwrite') tx.addEventListener('complete', () => controller.abort()); return tx; };
  try { const r = await b.commitMigration!(migrationRequest(t, controller.signal)); check(r.ok || r.code === 'outcome_unknown', 'oncomplete honest success/unknown'); check(value(await b.read('manual-1')).document?.schemaVersion === 2, 'new complete state after boundary'); }
  finally { IDBDatabase.prototype.transaction = transaction; }
  checks.push('cancel at committed boundary reports success-or-unknown, never assumed rollback');
  const denial = createIndexedDbStorage({ factory: { open() { throw new DOMException('denied', 'SecurityError'); } } as unknown as IDBFactory });
  check(!(await denial.inspectMigration!('manual-1')).ok, 'DB denied'); const c = new AbortController(); c.abort(); check(!(await b.commitMigration!(migrationRequest(t, c.signal))).ok, 'pre-cancel');
  checks.push('permission failure and pre-cancel bounded without write');
  const protections = name + '-protections'; await seedMigrationRace(protections, text);
  const p = createIndexedDbStorage({ databaseName: protections }), old = await decodeSaveVersioned(text);
  let before = await raw(protections);
  const upgrade = await p.write(createContactPrototype(), { slotId: 'manual-1', expectedToken: 'manual-1-current', allowReplaceWorld: true });
  check(!upgrade.ok && upgrade.code === 'migration_required', 'ordinary save cannot upgrade'); check(await raw(protections) === before, 'no ordinary cross-write');
  const migrated = value(await p.commitMigration!(migrationRequest(value(await p.inspectMigration!('manual-1')))));
  before = await raw(protections);
  const downgrade = await p.write(old.worldState, { slotId: 'manual-1', expectedToken: migrated.token, allowReplaceWorld: true });
  check(!downgrade.ok && downgrade.code === 'downgrade_refused', 'ordinary save cannot downgrade'); check(await raw(protections) === before, 'new relationships not stripped');
  const future = JSON.stringify({ format: 'aftermath-save', schemaVersion: 99, preserved: true });
  await edit(protections, tx => tx.objectStore('snapshots').put(future, 'manual-2-current'));
  check(!(await p.inspectMigration!('manual-2')).ok, 'future current cannot migrate'); check(value(await p.exportCurrent!('manual-2')).text === future, 'future raw export exact');
  checks.push('ordinary cross-version saves refused even with replacement flag; unknown future current preserved/exportable');
  const solo = name + '-no-previous'; await seedMigrationRace(solo, text); await edit(solo, tx => tx.objectStore('heads').put({ token: 'manual-1-current', previousToken: null }, 'manual-1'));
  const one = createIndexedDbStorage({ databaseName: solo }); value(await one.commitMigration!(migrationRequest(value(await one.inspectMigration!('manual-1')))));
  check(value(await one.listMigrationOriginals!('manual-1')).filter(o => o.source === 'archive').length === 1, 'one source when no previous');
  checks.push('genuine null previous allows upgrade with exactly one permanent source');
  const blockedName = name + '-blocked', blocker = await open(blockedName), upgrading = indexedDB.open(blockedName, 2);
  const done = new Promise<void>(resolve => { upgrading.onsuccess = () => { upgrading.result.close(); resolve(); }; });
  const blocked = createIndexedDbStorage({ databaseName: blockedName, timeoutMs: 30 });
  check(!(await blocked.inspectMigration!('manual-1')).ok, 'blocked open bounded');
  check(!(await blocked.commitMigration!(migrationRequest(t))).ok, 'blocked commit bounded'); blocker.close(); await done;
  checks.push('real blocked database upgrade queue bounded; late open closes without write');
  return checks;
}
let race: { store: ReturnType<typeof createIndexedDbStorage>; target: MigrationTarget };
export async function prepareMigrationRace(name: string, slot: ManualSlotId) { const store = createIndexedDbStorage({ databaseName: name }); race = { store, target: value(await store.inspectMigration!(slot)) }; }
export async function commitMigrationRace() { return race.store.commitMigration!(migrationRequest(race.target)); }
