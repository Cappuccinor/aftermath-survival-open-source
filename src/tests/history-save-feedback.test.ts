import { describe, it, expect, vi } from 'vitest';
import * as games from '../application/game';
import { createPersistenceController } from '../application/persistence';
import { createLifecyclePrototype } from '../core/npc-lifecycle-prototype';
import { encodeSave, decodeSave } from '../adapters/storage/save-format';
import type { ManualSaveStore, SlotContents } from '../adapters/storage/port';
import type { PersistenceView, PortResult } from '../application/ports';

function disk() {
  let contents: SlotContents = { token: null, document: null, previous: null }, writes = 0;
  const port: ManualSaveStore = {
    read: async () => ({ ok: true, value: contents }),
    write: async (world, request) => {
      if (request.expectedToken !== contents.token) return { ok: false, code: 'conflict' };
      writes++;
      contents = { token: 'history-feedback-' + writes, previous: contents.document,
        document: await decodeSave(await encodeSave(world, { gameBuild: 'test', savedAtUtc: '2026-10-26T00:00:00.000Z' })) };
      return { ok: true, value: contents };
    },
  };
  return { port, read: () => contents, writes: () => writes };
}

describe('committed history and truthful persistence subscription', () => {
  for (const automatic of [false, true]) for (const rejected of [false, true]) {
    it(`withdraws saved before historical fact is published, auto=${automatic}, rejected=${rejected}`, async () => {
      const d = disk(); let finish!: () => void;
      const c = createPersistenceController(d.port, { narrationTimeoutMs: 1000, narrator: {
        narrate: outcome => new Promise<PortResult<string>>((resolve, reject) => {
          finish = () => rejected ? reject(Error('delayed provider')) : resolve({ ok: true, value: outcome.summary });
        }),
      } });
      const s = c.start(createLifecyclePrototype()).session;
      await c.client.save(); if (automatic) await c.client.enableAutosave();
      let latest!: PersistenceView; c.client.subscribe(view => { latest = view; });
      const atHistory: PersistenceView[] = [];
      s.history!.subscribe(page => { if (page.total) atHistory.push(latest); });
      const saved = d.read(), pending = s.observe();
      try {
        await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
        expect(s.read().phase).toBe('pending'); expect(s.history!.read().total).toBe(1);
        expect(atHistory).toHaveLength(1);
        expect(atHistory[0]).toMatchObject({ savedToSelected: false, phase: 'idle' });
        expect(atHistory[0]!.currentDescription).toContain('当前进度未保存');
        expect(latest.message).toContain('未保存');
        if (automatic) expect(latest.autosave.message).toContain('呈现后');
        expect(d.read()).toBe(saved); expect(d.writes()).toBe(1);
        expect(latest.autosave.mode).toBe(automatic ? 'on' : 'off');
      } finally { finish(); await pending; }
      expect(s.history!.read().total).toBe(1);
      expect(d.writes()).toBe(automatic ? 2 : 1);
      expect(c.client.read().savedToSelected).toBe(automatic);
      expect(d.read().document!.worldRevision).toBe(automatic ? 1 : 0);
    });
  }
  it('same-ID retry after a lost reply does not repeat history or autosave', async () => {
    const realCreateGame = games.createGame;
    vi.spyOn(games, 'createGame').mockImplementation((...args) => {
      const real = realCreateGame(...args); let lost = false;
      return { dispatch: async input => {
        const reply = await real.dispatch(input);
        if (!lost) { lost = true; throw Error('test transport lost one committed reply'); }
        return reply;
      } };
    });
    try {
      const d = disk(), c = createPersistenceController(d.port), s = c.start(createLifecyclePrototype()).session;
      await c.client.save(); await c.client.enableAutosave();
      let historyNotifications = 0; s.history!.subscribe(page => { if (page.total) historyNotifications++; });
      await s.observe();
      expect(s.read().canRetry).toBe(true); expect(s.history!.read().total).toBe(1);
      expect(c.client.read()).toMatchObject({ phase: 'idle', savedToSelected: false }); expect(d.writes()).toBe(1);
      await s.retry();
      expect(s.history!.read().total).toBe(1); expect(historyNotifications).toBe(1); expect(d.writes()).toBe(2);
      expect(c.client.read()).toMatchObject({ phase: 'saved', savedToSelected: true });
      await s.retry(); expect(d.writes()).toBe(2); expect(historyNotifications).toBe(1);
    } finally { vi.restoreAllMocks(); }
  });
});
