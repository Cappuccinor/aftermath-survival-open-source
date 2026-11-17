import { expect, it } from 'vitest';
import { createEngine } from '../core/engine';
import { createInspectionPrototype } from '../core/prototype';
export function movementScene() {
 const w = JSON.parse(JSON.stringify(createInspectionPrototype()));
 const roomId = w.player.locationId, corridorId = 'prototype-corridor';
 w.locations[roomId].adjacentLocationIds = [corridorId];
 w.locations[corridorId] = { ...w.locations[roomId], locationId: corridorId, name: 'SECRET', light: 0.2, adjacentLocationIds: [roomId] };
 w.player.knownFactIds.push('known-prototype-route');
 w.knowledge.push({ knowerId: w.player.playerId, factId: 'known-prototype-route', source: 'evt-initial-route', confidence: 1, observedAt: 0 });
 w.eventJournal.push({ eventId: 'evt-initial-route', seq: 2, type: 'KnownRouteInitialized', worldTimeMinutes: 0, actorId: w.player.playerId, targetIds: [roomId, corridorId], visibility: 'private', payload: { rule: 'known-route-v1', roomId, corridorId } });
 return w;
}
export const cmd = (id: number, verb = 'move', targetIds = ['prototype-corridor'], revision = id) => ({ commandId: `move-${id}`, actorId: 'prototype-player', source: 'button', utterance: '', verb, targetIds, toolIds: [], arguments: {}, expectedWorldRevision: revision });
it('moves atomically and rebuilds 24 mixed actions with cross-location retry identity', () => {
 let engine = createEngine(movementScene()); const initial = engine.snapshot(); const commands: ReturnType<typeof cmd>[] = [];
 for (let i = 0; i < 24; i++) {
  const phase = i % 4; const c = phase === 0 ? cmd(i, 'inspect', ['prototype-tin']) : phase === 1 ? cmd(i) : phase === 2 ? cmd(i, 'observe', []) : cmd(i, 'move', ['prototype-location']);
  expect(engine.dispatch(c)).toMatchObject({ ok: true, replayed: false }); commands.push(c);
  engine = createEngine(JSON.parse(JSON.stringify(engine.snapshot())));
  for (const old of commands) expect(engine.dispatch(old)).toMatchObject({ ok: true, replayed: true });
  expect(engine.snapshot().campaign.gameClockMinutes).toBe(i + 1);
  expect(engine.snapshot().items).toEqual(initial.items); expect(engine.snapshot().rngState).toEqual(initial.rngState); expect(engine.snapshot().player.stats).toEqual(initial.player.stats);
 }
});
it('rejects forged historical observation location and final position', () => {
 const engine = createEngine(movementScene()); expect(engine.dispatch(cmd(0))).toMatchObject({ ok: true });
 const bad = JSON.parse(JSON.stringify(engine.snapshot())); bad.player.locationId = 'prototype-location';
 expect(() => createEngine(bad)).toThrow();
});

import { createGame } from '../application/game';
import { createObservationSession } from '../application/session';
import { localIntentInterpreter } from '../adapters/ai/local-intent';
import { projectClock } from '../application/clock';
it('projects authoritative location and routes through real session, leaving remote tin behind', async () => {
 const world = movementScene(); const client = createGame(world);
 const initial = await client.dispatch(cmd(0, 'observe', [])); expect(initial.ok).toBe(true); if (!initial.ok) return;
 expect(initial).toMatchObject({ currentLocation: { label: '房间' }, routes: [{ targetId: 'prototype-corridor', label: '走廊' }] });
 const s = createObservationSession({ client: createGame(world), interpreter: localIntentInterpreter, actorId: world.player.playerId, initialClock: projectClock(world), initialRoutes: [{ targetId: 'prototype-corridor', label: '走廊' }] });
 await s.move('prototype-corridor'); expect(s.read()).toMatchObject({ currentLocation: { label: '走廊' }, inspectTargets: [], clock: { gameClockMinutes: 1 } });
 s.setDraft('走到房间'); await s.submitText(); expect(s.read()).toMatchObject({ currentLocation: { label: '房间' }, inspectTargets: [{ label: '空罐' }], clock: { gameClockMinutes: 2 } });
 expect(JSON.stringify(s.read())).not.toContain('SECRET');
});
it.each(['前往走廊', '走到走廊'])('parses complete explicit movement %s only from disclosed routes', async phrase => {
 expect(await localIntentInterpreter.interpret({ utterance: phrase, view: { summary: '', facts: [] }, routes: [{ targetId: 'corridor', label: '走廊' }] }, { timeoutMs: 100 })).toEqual({ ok: true, value: { verb: 'move', targetId: 'corridor' } });
});
import { readFileSync } from 'node:fs';
import { MAX_CLOCK_MINUTES } from '../core/schema';
import { projectLocation, visibleRoutes } from '../core/movement';
import { visibleInspectionTargets } from '../core/inspection';
it.each(['observe', 'inspect'])('accepts fixed baseline %s then appends movement and retries old receipts', verb => {
 const old = JSON.parse(readFileSync(`src/tests/snapshots/g1-004-legacy-${verb}.json`, 'utf8'));
 const engine = createEngine(old); expect(engine.snapshot()).toEqual(old);
 expect(engine.dispatch(cmd(10, 'move', ['prototype-corridor'], old.campaign.worldRevision))).toMatchObject({ ok: true });
 const rebuilt = createEngine(JSON.parse(JSON.stringify(engine.snapshot())));
 expect(rebuilt.dispatch({ ...cmd(0, 'observe', []), commandId: 'legacy-observe' })).toMatchObject({ ok: true, replayed: true });
 expect(rebuilt.dispatch({ ...cmd(0, 'observe', ['prototype-location']), commandId: 'legacy-observe' })).toMatchObject({ ok: true, replayed: true });
 if (verb === 'inspect') expect(rebuilt.dispatch({ ...cmd(1, 'inspect', ['prototype-tin']), commandId: 'legacy-inspect' })).toMatchObject({ ok: true, replayed: true });
 expect(rebuilt.dispatch(cmd(11, 'move', ['prototype-location'], old.campaign.worldRevision + 1))).toMatchObject({ ok: true });
 expect(() => createEngine(JSON.parse(JSON.stringify(rebuilt.snapshot())))).not.toThrow();
});
it.each(['empty', 'multiple', 'current', 'missing', 'hidden', 'nonadjacent', 'unknown-route', 'weak-route', 'expired-route', 'wrong-source', 'wrong-version', 'tools', 'arguments', 'actor', 'revision', 'dead'])('rejects %s without a mutation or probe', mode => {
 const w = movementScene(); let c = cmd(0);
 if (mode === 'empty') c.targetIds = [];
 if (mode === 'multiple') c.targetIds.push('prototype-location');
 if (mode === 'current') c.targetIds = ['prototype-location'];
 if (mode === 'missing') c.targetIds = ['missing'];
 if (mode === 'hidden') { w.locations.hidden = { ...w.locations['prototype-corridor'], locationId: 'hidden' }; c.targetIds = ['hidden']; }
 if (mode === 'nonadjacent') w.locations['prototype-corridor'].adjacentLocationIds = [];
 if (mode === 'unknown-route') w.player.knownFactIds.pop();
 if (mode === 'weak-route') w.knowledge[1].confidence = 0.5;
 if (mode === 'expired-route') w.knowledge[1].expiresAt = 0;
 if (mode === 'wrong-source') w.knowledge[1].source = 'other';
 if (mode === 'wrong-version') w.eventJournal[1].payload.rule = 'known-route-v2';
 if (mode === 'tools') c = { ...c, toolIds: ['tool'] } as typeof c;
 if (mode === 'arguments') c.arguments = { force: true };
 if (mode === 'actor') c.actorId = 'other';
 if (mode === 'revision') c.expectedWorldRevision = 9;
 if (mode === 'dead') w.player.stats.hp = 0;
 const engine = createEngine(w); const before = engine.snapshot(); expect(engine.dispatch(c).ok).toBe(false); expect(engine.snapshot()).toBe(before);
 if (['missing', 'hidden', 'current', 'nonadjacent', 'unknown-route'].includes(mode)) expect(engine.dispatch(c)).toEqual({ ok: false, code: 'invalid_target' });
});
it.each(['time', 'revision', 'collision'])('candidate %s failure preserves state and does not consume ID', mode => {
 const w = movementScene();
 if (mode === 'time') w.campaign.gameClockMinutes = MAX_CLOCK_MINUTES;
 if (mode === 'revision') w.campaign.worldRevision = Number.MAX_SAFE_INTEGER;
 if (mode === 'collision') w.eventJournal.push({ ...w.eventJournal[1], eventId: 'evt-move-0-movement', seq: 3, type: 'Reserved' });
 const engine = createEngine(w); const before = engine.snapshot();
 expect(engine.dispatch(cmd(0, 'move', ['prototype-corridor'], w.campaign.worldRevision))).toEqual({ ok: false, code: 'settlement_failed' }); expect(engine.snapshot()).toBe(before);
});
it.each(['source', 'destination', 'version', 'order', 'observation', 'inspection', 'final'])('rejects damaged %s history', mode => {
 const e = createEngine(movementScene());
 expect(e.dispatch(cmd(0, 'inspect', ['prototype-tin'])).ok).toBe(true);
 expect(e.dispatch(cmd(1)).ok).toBe(true);
 expect(e.dispatch(cmd(2, 'observe', [])).ok).toBe(true);
 const w = JSON.parse(JSON.stringify(e.snapshot()));
 if (mode === 'source') w.eventJournal[5].payload.request.locationId = 'prototype-corridor';
 if (mode === 'destination') w.eventJournal[5].payload.request.destinationId = 'prototype-location';
 if (mode === 'version') w.eventJournal[5].payload.rule = 'move-v2';
 if (mode === 'order') [w.eventJournal[4], w.eventJournal[6]] = [w.eventJournal[6], w.eventJournal[4]];
 if (mode === 'observation') w.eventJournal[7].payload.request.locationId = 'prototype-location';
 if (mode === 'inspection') w.eventJournal[3].payload.request.locationId = 'prototype-corridor';
 if (mode === 'final') w.player.locationId = 'prototype-location';
 expect(() => createEngine(w)).toThrow();
});
it.each(['verb', 'target', 'revision', 'actor', 'arguments', 'tools'])('old ID conflicts on %s across locations', mode => {
 const e = createEngine(movementScene()); const old = cmd(0, 'observe', ['prototype-location']); expect(e.dispatch(old).ok).toBe(true); expect(e.dispatch(cmd(1)).ok).toBe(true);
 const conflict = JSON.parse(JSON.stringify(old));
 if (mode === 'verb') conflict.verb = 'move'; if (mode === 'target') conflict.targetIds = ['prototype-corridor'];
 if (mode === 'revision') conflict.expectedWorldRevision = 2; if (mode === 'actor') conflict.actorId = 'other';
 if (mode === 'arguments') conflict.arguments = { force: true }; if (mode === 'tools') conflict.toolIds = ['tool'];
 const before = e.snapshot(); expect(e.dispatch(conflict).ok).toBe(false); expect(e.snapshot()).toBe(before);
 expect(e.dispatch(old)).toMatchObject({ ok: true, replayed: true });
});
it('isolates engines and filters current perception without leaking arbitrary labels', () => {
 const a = createEngine(movementScene()), b = createEngine(movementScene()); expect(a.dispatch(cmd(0)).ok).toBe(true);
 expect(b.snapshot().player.locationId).toBe('prototype-location'); expect(projectLocation(a.snapshot())).toEqual({ targetId: 'prototype-corridor', label: '走廊' });
 expect(visibleRoutes(a.snapshot())).toEqual([{ targetId: 'prototype-location', label: '房间' }]); expect(visibleInspectionTargets(a.snapshot())).toEqual([]);
 expect(a.dispatch(cmd(1, 'inspect', ['prototype-tin']))).toEqual({ ok: false, code: 'invalid_target' });
 expect(a.dispatch(cmd(1, 'observe', []))).toMatchObject({ ok: true, receipt: { visibility: 'dark' } });
});
it.each(['我准备离开', '不要前往走廊', '如果安全就前往走廊', '前往走廊然后观察', '前往秘密房间', '前往prototype-corridor', '明天走到走廊', '前往走廊或房间'])('rejects text %s retaining draft and authoritative state', async text => {
 const w = movementScene(); const s = createObservationSession({ client: createGame(w), interpreter: localIntentInterpreter, actorId: w.player.playerId, initialClock: projectClock(w), initialRoutes: [{ targetId: 'prototype-corridor', label: '走廊' }] });
 s.setDraft(text); await s.submitText(); expect(s.read()).toMatchObject({ phase: 'error', draft: text, clock: { gameClockMinutes: 0 } });
 s.setDraft('前往走廊'); await s.submitText(); expect(s.read().clock.gameClockMinutes).toBe(1);
});
it('rejects expiring movement knowledge instead of accepting a weakened location receipt', () => {
 const e = createEngine(movementScene()); expect(e.dispatch(cmd(0)).ok).toBe(true);
 const w = JSON.parse(JSON.stringify(e.snapshot())); w.knowledge.at(-1).expiresAt = 2;
 expect(() => createEngine(w)).toThrow();
});
it('uncertain move retries identical command once and late historical reply cannot roll back projection', async () => {
 const w = movementScene(), game = createGame(w); const seen: unknown[] = []; let first: Awaited<ReturnType<typeof game.dispatch>> | undefined;
 const s = createObservationSession({ client: { dispatch: async c => {
  seen.push(c); if (seen.length === 4) return first!;
  const reply = await game.dispatch(c); if (seen.length === 1) { first = reply; throw new Error('lost response'); } return reply;
 } }, interpreter: localIntentInterpreter, actorId: w.player.playerId, initialClock: projectClock(w), initialRoutes: [{ targetId: 'prototype-corridor', label: '走廊' }] });
 s.setDraft('前往走廊'); await s.submitText(); expect(s.read().canRetry).toBe(true);
 await s.observe(); await s.move('prototype-corridor'); expect(seen).toHaveLength(1);
 s.setDraft('保留编辑'); await s.retry(); expect(seen[1]).toEqual(seen[0]); expect(s.read()).toMatchObject({ draft: '保留编辑', currentLocation: { label: '走廊' }, clock: { gameClockMinutes: 1 } });
 await s.move('prototype-location'); expect(s.read().currentLocation?.label).toBe('房间'); const before = s.read();
 await s.observe(); expect(s.read().clock).toEqual(before.clock); expect(s.read().routes).toEqual(before.routes); expect(s.read().currentLocation).toEqual(before.currentLocation); expect(s.read().entries).toEqual(before.entries);
});
it('button and both explicit texts produce identical entire worlds', async () => {
 const worlds = [];
 for (const text of [null, '前往走廊', '走到走廊']) {
  const w = movementScene(), engine = createEngine(w), game = createGame(w);
  const s = createObservationSession({ client: { dispatch: async c => { expect(engine.dispatch(c).ok).toBe(true); return game.dispatch(c); } }, interpreter: localIntentInterpreter, actorId: w.player.playerId, initialClock: projectClock(w), initialRoutes: [{ targetId: 'prototype-corridor', label: '走廊' }] });
  if (text === null) await s.move('prototype-corridor'); else { s.setDraft(text); await s.submitText(); }
  worlds.push(engine.snapshot());
 }
 expect(worlds[1]).toEqual(worlds[0]); expect(worlds[2]).toEqual(worlds[0]);
});
