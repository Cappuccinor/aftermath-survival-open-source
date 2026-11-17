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
import { transferEntries, cabinet, water, tin, corridor, room, bothDiscovered, action } from './transfer-fixtures';
function session(w: WorldState, client: GameClient = createGame(w), interpreter = localIntentInterpreter) {
  return createObservationSession({ client, interpreter, actorId: w.player.playerId, initialClock: projectClock(w), initialSearchTargets: visibleSearchTargets(w),
    initialTargets: visibleInspectionTargets(w), initialPickupTargets: visiblePickupTargets(w), initialInventory: projectInventory(w), initialPlayerStatus: projectPlayerStatus(w),
    initialLocation: projectLocation(w), initialRoutes: visibleRoutes(w), timeoutMs: 20 });
}
const originalEngine = core.createEngine;
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
for (const [name, factory] of transferEntries) for (const order of [[tin, water], [water, tin]]) {
  test(`${name} button/text same worlds; order ${order.join(',')}; no respawn`, async () => {
    const engines: ReturnType<typeof core.createEngine>[] = [];
    vi.spyOn(core, 'createEngine').mockImplementation(w => { const e = originalEngine(w); engines.push(e); return e; });
    const button = session(factory()), text = session(factory());
    expect(JSON.stringify(text.read())).not.toMatch(/bottled-water|瓶装水|sealed/);
    for (const s of [button, text]) { await s.search(room); await s.search(cabinet); expect(s.read().pickupTargets).toHaveLength(2); }
    expect(text.read().entries.at(-1)!.summary).toMatch(/发现瓶装水.*仍在柜中/);
    expect(text.read().entries.at(-1)!.summary).not.toContain('尚未支持');
    const first = engines[1]!.snapshot().knowledge.find(k => k.factId === `cabinet-discovery-${water}`);
    for (const [i, id] of order.entries()) {
      await button.pickUp(id!); text.setDraft(id === water ? '请把这个瓶装水拿起来' : '拿起空罐'); await text.submitText();
      expect(text.read().phase).toBe('success'); expect(engines[0]!.snapshot()).toEqual(engines[1]!.snapshot());
      expect(text.read().inventory).toHaveLength(i + 1); expect(text.read().pickupTargets).toHaveLength(1 - i);
      expect(text.read().entries.at(-1)!.summary).toBe(`你花了一分钟拾起${id === water ? '瓶装水' : '空罐'}。`);
    }
    expect(text.read().playerStatus?.carryWeightKg).toBe(.55);
    for (const s of [button, text]) { await s.search(cabinet); expect(s.read().entries.at(-1)!.summary).toContain('已取出'); await s.move(corridor); expect(s.read().inventory).toHaveLength(2); await s.move(room); await s.search(cabinet); expect(s.read().pickupTargets).toEqual([]); }
    expect(engines[0]!.snapshot()).toEqual(engines[1]!.snapshot());
    expect(engines[1]!.snapshot().knowledge.find(k => k.factId === `cabinet-discovery-${water}`)).toEqual(first);
  });
}
test('hidden water never reaches interpreter/narrator before discovery; direct hidden target refused without facts', async () => {
  const inputs: unknown[] = [], narrated: unknown[] = [], w = transferEntries[0][1]();
  const game = createGame(w, { narrator: { narrate: async input => { narrated.push(input); return { ok: false, code: 'not_implemented' }; } } });
  const s = session(w, game, { interpret: async (input, context) => { inputs.push(input); return localIntentInterpreter.interpret(input, context); } });
  s.setDraft('搜索房间'); await s.submitText(); await s.pickUp(water);
  expect(JSON.stringify([inputs, narrated, s.read()])).not.toMatch(/bottled-water|瓶装水|sealed|transfer-scope/);
  await s.search(cabinet); s.setDraft('拿起瓶装水'); await s.submitText(); expect(s.read().inventory).toHaveLength(1);
  expect(JSON.stringify(narrated)).not.toMatch(/prototype-bottled-water|weightKg|sealed|rngState|scope/);
});
test.each(['检查瓶装水', '喝水', '喝瓶装水', '丢弃瓶装水', '交易瓶装水', '拿起瓶装水并喝水', '再给我一瓶水', '我准备拿起瓶装水'])('unsupported %s keeps world/draft and recovers', async phrase => {
  let e!: ReturnType<typeof core.createEngine>; vi.spyOn(core, 'createEngine').mockImplementation(w => e = originalEngine(w));
  const s = session(transferEntries[0][1]());
  for (let n = 0; n < 3; n++) {
    const before = e.snapshot(), clock = s.read().clock; s.setDraft(phrase); await s.submitText();
    expect(s.read()).toMatchObject({ phase: 'error', draft: phrase, clock }); expect(e.snapshot()).toBe(before);
    if (n === 0) await s.search(cabinet); else if (n === 1) await s.pickUp(water); else await s.observe();
    expect(s.read().phase).toBe('success');
  }
});
test('water pending/timeout/late/retry preserves edited draft and one transfer while both buttons locked', async () => {
  vi.useFakeTimers(); const w = bothDiscovered().snapshot(), game = createGame(w), commands: unknown[] = [];
  let resolve!: (r: ActionReply) => void, stored!: ActionReply;
  const late = new Promise<ActionReply>(r => resolve = r);
  const s = session(w, { dispatch: async c => { commands.push(c); stored = await game.dispatch(c); return commands.length === 1 ? late : stored; } });
  s.setDraft('拿起瓶装水'); const work = s.submitText(); await vi.advanceTimersByTimeAsync(1);
  expect(s.read()).toMatchObject({ phase: 'pending', inventory: [] }); s.setDraft('下一步想法'); await s.pickUp(tin); await s.pickUp(water); expect(commands).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(21); await work; const timedOut = s.read(); expect(timedOut.canRetry).toBe(true);
  resolve(stored); await vi.advanceTimersByTimeAsync(1); expect(s.read()).toBe(timedOut);
  await s.retry(); expect(commands[1]).toBe(commands[0]); expect(s.read()).toMatchObject({ phase: 'success', draft: '下一步想法', playerStatus: { carryWeightKg: .5 }, clock: { worldRevision: 3 }, inventory: [{ itemId: water }] });
  expect(s.read().entries).toHaveLength(1); await s.pickUp(tin); expect(s.read().playerStatus?.carryWeightKg).toBe(.55);
});
test('stale discovery receipt cannot roll back ownership/load/targets; separate world stays undiscovered', async () => {
  const w = transferEntries[0][1](), game = createGame(w); let first!: ActionReply, n = 0;
  const s = session(w, { dispatch: async c => { n++; if (n === 4) return first; const r = await game.dispatch(c); if (n === 1) first = r; return r; } }), other = session(w);
  await s.search(cabinet); await s.pickUp(water); await s.move(corridor); const view = s.read(); await s.observe();
  for (const key of ['inventory', 'playerStatus', 'pickupTargets', 'clock', 'entries', 'searchTargets'] as const) expect(s.read()[key]).toEqual(view[key]);
  expect(JSON.stringify(other.read())).not.toMatch(/瓶装水|bottled-water/); await other.search(cabinet); expect(other.read().inventory).toEqual([]);
});
test('replayed old cabinet search returns its historical cabinet narrative after water transfer', async () => {
  const w = transferEntries[0][1](), g = createGame(w), c = action('search', 0, cabinet, w.player.playerId);
  const old = await g.dispatch(c); await g.dispatch(action('pick_up', 1, water, w.player.playerId));
  const current = await g.dispatch(action('search', 2, cabinet, w.player.playerId)), retry = await g.dispatch(c);
  expect(old.ok && retry.ok && retry.outcome).toEqual(old.ok && old.outcome); expect(current.ok && current.outcome.summary).toContain('已取出');
  expect(retry.ok && retry.inventory).toMatchObject([{ itemId: water }]);
});
test.each(['你获得两瓶水。', '柜子重新出现一瓶水。', '你喝水后不再口渴。', '瓶装水安全可饮，容量500毫升。'])('narrator false claim %s falls back without world changes', async claim => {
  const w = bothDiscovered().snapshot(), engines: ReturnType<typeof core.createEngine>[] = [];
  vi.spyOn(core, 'createEngine').mockImplementation(w => { const e = originalEngine(w); engines.push(e); return e; });
  const safe = createGame(w), bad = createGame(w, { narrator: { narrate: async () => ({ ok: true, value: claim }) } });
  const c = action('pick_up', 2, water, w.player.playerId);
  const a = await safe.dispatch(c), b = await bad.dispatch(c); expect(b).toEqual(a);
  expect(b.ok && b.outcome.summary).toBe('你花了一分钟拾起瓶装水。'); expect(engines[0]!.snapshot()).toEqual(engines[1]!.snapshot());
});
