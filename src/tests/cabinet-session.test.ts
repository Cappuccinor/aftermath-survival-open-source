import { afterEach, expect, test, vi } from 'vitest';
import * as core from '../core/engine';
import { createGame } from '../application/game';
import { createObservationSession } from '../application/session';
import { localIntentInterpreter } from '../adapters/ai/local-intent';
import { projectClock } from '../application/clock';
import { projectInventory } from '../application/inventory';
import { projectPlayerStatus } from '../application/player-status';
import { projectLocation, visibleRoutes } from '../core/movement';
import { visibleSearchTargets } from '../core/search';
import { visibleInspectionTargets } from '../core/inspection';
import { visiblePickupTargets } from '../core/pickup';
import type { WorldState } from '../core/world';
import type { ActionReply, GameClient } from '../application/ports';
import { entries, cabinet, water, corridor, room } from './cabinet-fixtures';
function session(w: WorldState, client: GameClient = createGame(w), interpreter = localIntentInterpreter) {
  return createObservationSession({ client, interpreter, actorId: w.player.playerId, initialClock: projectClock(w), initialSearchTargets: visibleSearchTargets(w),
    initialTargets: visibleInspectionTargets(w), initialPickupTargets: visiblePickupTargets(w), initialInventory: projectInventory(w), initialPlayerStatus: projectPlayerStatus(w),
    initialLocation: projectLocation(w), initialRoutes: visibleRoutes(w), timeoutMs: 20 });
}
const originalEngine = core.createEngine;
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
test.each(entries)('%s text and button execute the same real world; first result says water remains inside', async (_, factory) => {
  const engines: ReturnType<typeof core.createEngine>[] = [];
  vi.spyOn(core, 'createEngine').mockImplementation(w => { const e = originalEngine(w); engines.push(e); return e; });
  const button = session(factory()), text = session(factory());
  expect(JSON.stringify(text.read())).not.toMatch(/bottled-water|瓶装水|sealed|0\.5/);
  await button.search(cabinet); text.setDraft('请搜索一下这个柜子'); await text.submitText();
  expect(text.read().phase).toBe('success'); expect(text.read().clock.worldRevision).toBe(1);
  expect(engines[0]!.snapshot()).toEqual(engines[1]!.snapshot());
  expect(text.read().entries.at(-1)?.summary).toMatch(/发现瓶装水.*仍在柜中.*尚未支持取出/);
  expect(text.read()).toMatchObject({ inventory: [], inspectTargets: [], pickupTargets: [] });
  const first = engines[1]!.snapshot().knowledge.find(k => k.factId === `cabinet-discovery-${water}`);
  text.setDraft('搜索柜子'); await text.submitText(); expect(text.read().entries.at(-1)?.summary).toContain('没有新发现');
  expect(text.read().entries.at(-1)?.summary).not.toMatch(/空了|已获得|安全|毫升/);
  expect(engines[1]!.snapshot().knowledge.find(k => k.factId === `cabinet-discovery-${water}`)).toEqual(first);
  await text.move(corridor); expect(text.read().searchTargets).toEqual([]);
  const before = engines[1]!.snapshot(); text.setDraft('搜索柜子'); await text.submitText();
  expect(text.read().phase).toBe('error'); expect(engines[1]!.snapshot()).toBe(before);
  await text.move(room); expect(text.read().searchTargets).toHaveLength(2); await text.search(cabinet);
  expect(text.read().entries.at(-1)?.summary).toContain('没有新发现');
  expect(engines[1]!.snapshot().knowledge.find(k => k.factId === `cabinet-discovery-${water}`)).toEqual(first);
});
test.each(entries)('%s filters pre-discovery interpreter and narrator inputs, room search stays tin-only', async (_, factory) => {
  const inputs: unknown[] = [], narrated: unknown[] = [];
  const game = createGame(factory(), { narrator: { narrate: async (input: any) => { narrated.push(input); return { ok: false, code: 'unavailable' } as any; } } });
  const s = session(factory(), game, { interpret: async (input, context) => { inputs.push(input); return localIntentInterpreter.interpret(input, context); } });
  s.setDraft('搜索房间'); await s.submitText();
  expect(JSON.stringify([inputs, narrated, s.read()])).not.toMatch(/bottled-water|瓶装水|sealed|cabinet-scope/);
  expect(s.read().entries.at(-1)?.summary).toContain('空罐');
  await s.search(cabinet); expect(s.read().entries.at(-1)?.summary).toContain('瓶装水');
  expect(JSON.stringify(narrated)).not.toMatch(/prototype-bottled-water|weightKg|sealed|rngState|cabinet-scope/);
});
test.each(['拿起瓶装水', '拾取瓶装水', '检查瓶装水', '喝水', '搜索柜子然后喝水', '搜索柜子并拾取', '我准备搜索柜子'])('unsupported %s retains draft/time/world before and after discovery', async text => {
  let engine!: ReturnType<typeof core.createEngine>;
  vi.spyOn(core, 'createEngine').mockImplementation(w => engine = originalEngine(w));
  const s = session(entries[0][1]());
  for (let n = 0; n < 2; n++) {
    const before = engine.snapshot(), clock = s.read().clock; s.setDraft(text); await s.submitText();
    expect(s.read()).toMatchObject({ phase: 'error', draft: text, clock }); expect(engine.snapshot()).toBe(before);
    await s.search(cabinet); expect(s.read().phase).toBe('success');
  }
});
test('pending edits survive timeout; late response ignored; identical retry confirms one discovery then next action works', async () => {
  vi.useFakeTimers(); const w = entries[0][1](), game = createGame(w), commands: unknown[] = [];
  let resolve!: (r: ActionReply) => void, stored!: ActionReply;
  const late = new Promise<ActionReply>(r => resolve = r);
  const s = session(w, { dispatch: async c => { commands.push(c); stored = await game.dispatch(c); return commands.length === 1 ? late : stored; } });
  s.setDraft('搜索柜子'); const work = s.submitText(); await vi.advanceTimersByTimeAsync(1);
  expect(s.read().phase).toBe('pending'); s.setDraft('后续想法'); await s.search(cabinet); await s.search(room); expect(commands).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(21); await work; expect(s.read()).toMatchObject({ canRetry: true, draft: '后续想法' });
  const timedOut = s.read(); resolve(stored); await vi.advanceTimersByTimeAsync(1); expect(s.read()).toBe(timedOut);
  await s.retry(); expect(commands[1]).toBe(commands[0]); expect(s.read()).toMatchObject({ phase: 'success', canRetry: false, draft: '后续想法', clock: { worldRevision: 1 }, inventory: [] });
  expect(s.read().entries).toHaveLength(1); expect(s.read().entries[0]!.summary).toContain('仍在柜中');
  await s.search(cabinet); expect(s.read().clock.worldRevision).toBe(2); expect(s.read().entries.at(-1)?.summary).toContain('没有新发现');
});
test('two worlds never share discovery; stale receipt cannot restore room targets after departure', async () => {
  const w = entries[0][1](), game = createGame(w); let first!: ActionReply, n = 0;
  const s = session(w, { dispatch: async c => { n++; if (n === 3) return first; const r = await game.dispatch(c); if (n === 1) first = r; return r; } });
  const other = session(w); await s.search(cabinet); await s.move(corridor); const view = s.read(); await s.observe();
  expect(s.read().clock).toEqual(view.clock); expect(s.read().searchTargets).toEqual([]); expect(s.read().entries).toEqual(view.entries);
  expect(JSON.stringify(other.read())).not.toMatch(/瓶装水|bottled-water/); await other.search(cabinet);
  expect(other.read().entries[0]!.summary).toContain('发现瓶装水'); expect(other.read().clock.worldRevision).toBe(1);
});
