// Trusted, isolated test composition. Never imported by product bootstrap.
import { createPersistenceController } from '../../application/persistence';
import { createIndexedDbStorage } from '../../adapters/storage/indexed-db';
import { canonicalJSON } from '../../adapters/storage/save-format';
import { createLifecyclePrototype } from '../../core/npc-lifecycle-prototype';
import { createEngine } from '../../core/engine';
import { readActionReceipts } from '../../core/receipts';
import { mountObservationUI } from '../../ui/main';
import type { ManualSaveStore, SlotContents, SaveResult } from '../../adapters/storage/port';
import type { StartedGame } from '../../application/ports';

export function install() {
  const root = document.querySelector<HTMLElement>('#app')!;
  const native = createIndexedDbStorage();
  let mode = 'normal', narration = 'normal', calls = 0, snapshotSuccesses = 0;
  let release: (() => void) | undefined, lateNarration: (() => void) | undefined;
  const port: ManualSaveStore = {
    read: (id, signal) => native.read(id, signal),
    async write(world, request) {
      calls++; const fault = mode;
      if (fault === 'hold') await new Promise<void>(resolve => release = resolve);
      if (fault === 'late-success' || fault === 'late-failure') {
        return new Promise<SaveResult<SlotContents>>(resolve => { release = () => resolve(fault === 'late-success'
          ? { ok: true, value: { token: 'late', document: null, previous: null } } : { ok: false, code: 'storage_error' }); });
      }
      const cancel = new AbortController(), abort = () => cancel.abort();
      request.signal?.addEventListener('abort', abort, { once: true });
      if (request.signal?.aborted) cancel.abort();
      const original = IDBObjectStore.prototype.put;
      if (['abort', 'quota', 'cancel'].includes(fault)) IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
        const result = original.apply(this, args);
        if (this.name === 'snapshots') result.addEventListener('success', () => {
          snapshotSuccesses++;
          if (fault === 'abort') this.transaction.abort();
          if (fault === 'quota') {
            // Inject quota classification only after a real request success; native abort rolls back all writes.
            Object.defineProperty(this.transaction, 'error', { value: new DOMException('injected quota', 'QuotaExceededError') });
            this.transaction.abort();
          }
          if (fault === 'cancel') cancel.abort();
        }, { once: true });
        return result;
      };
      try { return await native.write(world, { ...request, signal: cancel.signal }); }
      finally { IDBObjectStore.prototype.put = original; request.signal?.removeEventListener('abort', abort); }
    },
  };
  const c = createPersistenceController(port, { timeoutMs: 300, narrationTimeoutMs: 25, narrator: { async narrate(input) {
    if (narration === 'reject') throw Error('injected narrator');
    if (narration === 'cancel') return { ok: false, code: 'cancelled' };
    if (narration === 'late') return new Promise(resolve => { lateNarration = () => resolve({ ok: true, value: input.summary }); });
    return { ok: true, value: input.summary };
  } } });
  let active: StartedGame;
  const start = () => { const w = createLifecyclePrototype(1); active = c.start(createEngine({ ...w, campaign: { ...w.campaign, saveId: `fault-${crypto.randomUUID()}` } }).snapshot()); return active.session; };
  mountObservationUI(root, start, undefined, c.client);
  return {
    fault: (value: string) => { mode = value; }, narration: (value: string) => { narration = value; },
    release: () => { const fn = release; release = undefined; fn?.(); }, lateNarration: () => lateNarration?.(),
    read: () => ({ calls, snapshotSuccesses, persistence: c.client.read(), session: active?.session.read() }),
    async seedOthers() {
      for (const slotId of ['manual-2', 'manual-3'] as const) {
        const result = await native.write(createLifecyclePrototype(1), { slotId, expectedToken: null, allowReplaceWorld: false });
        if (!result.ok) throw Error(result.code);
      }
    },
    newWorld: start,
    async raw() {
      const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('aftermath-survival', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      try { return await new Promise<string>((resolve, reject) => { const tx = db.transaction(['heads', 'snapshots']); const requests = ['heads', 'snapshots'].flatMap(s => [tx.objectStore(s).getAllKeys(), tx.objectStore(s).getAll()]); tx.oncomplete = () => resolve(JSON.stringify(requests.map(r => r.result))); tx.onabort = () => reject(tx.error); }); }
      finally { db.close(); }
    },
    async verifyRecovery() {
      const saved = await native.read('manual-1'); if (!saved.ok || !saved.value.document) throw Error('missing save');
      const w = saved.value.document.worldState, engine = createEngine(w);
      const before = JSON.stringify(w);
      for (const receipt of readActionReceipts(w)) {
        let verb = 'observe', targetIds: string[] = [], args = {};
        if (receipt.rule === 'cabinet-search-v2') { verb = 'search'; targetIds = [receipt.request.cabinetId]; }
        else if (receipt.rule === 'pick_up-v2') { verb = 'pick_up'; targetIds = [receipt.request.itemId]; }
        else if (receipt.rule === 'observe-v1') targetIds = [receipt.request.locationId];
        else throw Error('Unexpected receipt in isolated sequence');
        const r = engine.dispatch({ commandId: receipt.commandId, actorId: receipt.request.actorId, source: 'button', verb, targetIds, toolIds: [], arguments: args, utterance: '', expectedWorldRevision: receipt.request.expectedWorldRevision });
        if (!r.ok || !r.replayed || JSON.stringify(engine.snapshot()) !== before) throw Error('Replay changed world');
      }
      const restored = createPersistenceController(native), loaded = await restored.client.load(); if (!loaded) throw Error('Restore failed');
      if (JSON.stringify(loaded.session.read().inventory) !== JSON.stringify(active.session.read().inventory)) throw Error('Inventory restore');
      const door = loaded.session.read().doorTargets[0]!.targetId;
      await restored.client.enableAutosave(); await loaded.session.observeDoorGap(door);
      const after = await native.read('manual-1'); if (!after.ok || !after.value.document) throw Error('No next snapshot');
      const next = after.value.document.worldState, receipt = readActionReceipts(next).at(-1)!;
      const r = engine.dispatch({ commandId: receipt.commandId, actorId: w.player.playerId, source: 'button', verb: 'observe', targetIds: [door], toolIds: [], arguments: { through: 'door_gap', careful: true }, utterance: '', expectedWorldRevision: w.campaign.worldRevision });
      if (!r.ok || canonicalJSON(engine.snapshot()) !== canonicalJSON(next)) throw Error('RNG/full-world continuation');
      return { originalReceipts: readActionReceipts(w).length, wholeWorldAndNextRngEqual: true };
    },
  };
}
