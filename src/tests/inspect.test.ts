import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createEngine } from '../core/engine';
import { parseWorldState } from '../core/world';
import { visibleInspectionTargets } from '../core/inspection';
import { MAX_CLOCK_MINUTES } from '../core/schema';
import { createGame } from '../application/game';
import { mutableJson } from './fixtures';
import { observe, scene } from './observe-fixtures';
import { inspect, inspectionScene } from './inspect-fixtures';

describe('G1-003: known and currently perceivable inspection', () => {
  it.each(['g0-empty', 'g1-observe-v1'])('accepts the literal %s JSON produced by baseline f28f619 without rewriting it', name => {
    const encoded = readFileSync(`src/tests/snapshots/${name}.json`, 'utf8');
    const legacy = JSON.parse(encoded); const engine = createEngine(legacy);
    expect(engine.snapshot()).toEqual(legacy);
    const result = engine.dispatch(observe());
    expect(result).toMatchObject({ ok: true, replayed: name === 'g1-observe-v1' });
    expect(engine.snapshot().campaign.gameClockMinutes).toBe(1);
    expect(readFileSync(`src/tests/snapshots/${name}.json`, 'utf8')).toBe(encoded);
  });
  it('preserves the old observe-v1 knowledge expiry acceptance without imposing inspect-only restrictions', () => {
    const old = JSON.parse(readFileSync('src/tests/snapshots/g1-observe-v1.json', 'utf8'));
    old.knowledge[0].expiresAt = 2;
    expect(createEngine(old).dispatch(observe())).toMatchObject({ ok: true, replayed: true });
  });
  it('projects only an evidenced current target and an immutable controlled label', () => {
    const world = inspectionScene();
    world.items.hidden = { ...world.items['tin-1'], itemId: 'hidden', typeId: 'SECRET_gun' };
    const targets = visibleInspectionTargets(parseWorldState(world));
    expect(targets).toEqual([{ targetId: 'tin-1', label: '空罐' }]);
    expect(Object.isFrozen(targets)).toBe(true); expect(Object.isFrozen(targets[0])).toBe(true);
    expect(JSON.stringify(targets)).not.toMatch(/SECRET|empty-tin|condition|metadata|hidden/);
  });
  it('atomically commits one minute, paired events and appearance knowledge, leaving items and RNG intact', () => {
    const engine = createEngine(inspectionScene()); const old = engine.snapshot();
    expect(engine.dispatch(inspect())).toMatchObject({ ok: true, replayed: false, receipt: {
      rule: 'inspect-v1', appearance: 'open-metal-tin-v1', elapsedMinutes: 1, observedAt: 1, committedRevision: 1 } });
    const next = engine.snapshot();
    expect(next.campaign).toMatchObject({ gameClockMinutes: 1, worldRevision: 1 });
    expect(next.items).toEqual(old.items); expect(next.rngState).toEqual(old.rngState);
    expect(next.player.stats).toEqual(old.player.stats);
    expect(next.eventJournal.slice(1).map(e => [e.type, e.seq, e.targetIds])).toEqual([
      ['TimeAdvanced', 2, ['tin-1']], ['InspectionRecorded', 3, ['tin-1']],
    ]);
    expect(next.knowledge).toContainEqual({ knowerId: 'player-1', factId: 'inspection-tin-1-appearance',
      source: 'evt-cmd-1-inspection', confidence: 1, observedAt: 1 });
    expect(next.player.knownFactIds).toContain('inspection-tin-1-appearance');
    expect(old.campaign.worldRevision).toBe(0); expect(old.eventJournal).toHaveLength(1);
  });
  it.each(['unknown', 'missing', 'remote', 'container', 'inventory', 'dark', 'unlisted', 'no-evidence', 'forged-source', 'wrong-actor', 'expired', 'weak', 'wrong-type', 'wrong-basis'])('%s target is uniformly rejected without mutation or suggestion', mode => {
    const world = inspectionScene(); const item = world.items['tin-1'];
    if (mode === 'unknown') { world.player.knownFactIds = []; world.knowledge = []; }
    if (mode === 'missing') { world.items = {}; world.eventJournal = []; world.knowledge = []; world.player.knownFactIds = []; }
    if (mode === 'remote') { world.locations.remote = { ...world.locations['location-1'], locationId: 'remote' }; item.position.id = 'remote'; }
    if (mode === 'container') { world.items.box = { ...item, itemId: 'box' }; item.position = { kind: 'container', id: 'box' }; }
    if (mode === 'inventory') item.position = { kind: 'player', id: 'player-1' };
    if (mode === 'dark') world.locations['location-1'].light = 0.49;
    if (mode === 'unlisted') world.player.knownFactIds = [];
    if (mode === 'no-evidence') world.eventJournal = [];
    if (mode === 'forged-source') world.knowledge[0].source = 'invented';
    if (mode === 'wrong-actor') world.eventJournal[0].actorId = null;
    if (mode === 'expired') { world.campaign.gameClockMinutes = 1; world.knowledge[0].expiresAt = 0; }
    if (mode === 'weak') world.knowledge[0].confidence = 0.5;
    if (mode === 'wrong-type') item.typeId = 'SECRET_type';
    if (mode === 'wrong-basis') world.eventJournal[0].payload.rule = 'initial-sight-v99';
    const engine = createEngine(world); const before = engine.snapshot();
    expect(visibleInspectionTargets(before)).toEqual([]);
    expect(engine.dispatch(inspect())).toEqual({ ok: false, code: 'invalid_target' });
    expect(engine.snapshot()).toBe(before);
  });
  it.each([
    [{ targetIds: [] }, 'invalid_target'], [{ targetIds: ['tin-1', 'tin-1'] }, 'invalid_target'],
    [{ actorId: 'other' }, 'invalid_actor'], [{ toolIds: ['tool'] }, 'unsupported_parameters'],
    [{ arguments: { careful: true } }, 'unsupported_parameters'], [{ expectedWorldRevision: 1 }, 'stale_revision'],
    [{ worldState: {} }, 'invalid_command'],
  ])('strict command rejection %# retains the exact old snapshot and permits recovery', (change, code) => {
    const engine = createEngine(inspectionScene()); const before = engine.snapshot();
    expect(engine.dispatch({ ...inspect(), ...change })).toEqual({ ok: false, code });
    expect(engine.snapshot()).toBe(before);
    expect(engine.dispatch(inspect()).ok).toBe(true);
  });
  it('dead actor cannot inspect or receive an actionable suggestion', () => {
    const world = inspectionScene(); world.player.stats.hp = 0;
    const engine = createEngine(world); const before = engine.snapshot();
    expect(engine.dispatch(inspect())).toEqual({ ok: false, code: 'actor_unavailable' });
    expect(visibleInspectionTargets(before)).toEqual([]); expect(engine.snapshot()).toBe(before);
  });
  it('accepts the exact light threshold', () => {
    const world = inspectionScene(); world.locations['location-1'].light = 0.5;
    expect(createEngine(world).dispatch(inspect()).ok).toBe(true);
  });
  it('20 mixed actions are deterministic, conservative, isolated and retryable after JSON reconstruction', () => {
    const initial = inspectionScene(); const untouched = createEngine(initial);
    const run = () => {
      let engine = createEngine(initial);
      for (let i = 0; i < 20; i++) {
        const command = i % 2 === 0 ? inspect(`cmd-${i}`, i) : observe(`cmd-${i}`, i);
        expect(engine.dispatch(command).ok).toBe(true);
        engine = createEngine(mutableJson(engine.snapshot()));
        const before = engine.snapshot();
        expect(engine.dispatch(command)).toMatchObject({ ok: true, replayed: true });
        expect(engine.snapshot()).toBe(before);
        expect(before.items).toEqual(initial.items); expect(before.rngState).toEqual(initial.rngState);
        expect(before.campaign).toMatchObject({ gameClockMinutes: i + 1, worldRevision: i + 1 });
      }
      return engine.snapshot();
    };
    const first = run(); expect(run()).toEqual(first);
    expect(first.eventJournal.map(e => e.seq)).toEqual(Array.from({ length: 41 }, (_, i) => i + 1));
    expect(first.knowledge).toHaveLength(3); expect(untouched.snapshot()).toEqual(initial);
  });
  it('deduplicates after later mixed actions and rejects cross-action/target/revision ID reuse', () => {
    const engine = createEngine(inspectionScene()); const first = engine.dispatch(inspect());
    expect(first.ok).toBe(true); expect(engine.dispatch(observe('cmd-2', 1)).ok).toBe(true);
    const before = engine.snapshot();
    expect(engine.dispatch({ ...inspect(), source: 'button', utterance: '查看空罐' })).toMatchObject({ ok: true, replayed: true });
    for (const command of [observe(), inspect('cmd-1', 0, 'unknown'), inspect('cmd-1', 2), inspect('cmd-2', 1)]) {
      expect(engine.dispatch(command)).toEqual({ ok: false, code: 'command_id_conflict' });
      expect(engine.snapshot()).toBe(before);
    }
  });
  it.each(['clock', 'revision', 'event'])('%s candidate failure never partially commits', kind => {
    const world = inspectionScene();
    if (kind === 'clock') world.campaign.gameClockMinutes = MAX_CLOCK_MINUTES;
    if (kind === 'revision') world.campaign.worldRevision = Number.MAX_SAFE_INTEGER;
    if (kind === 'event') world.eventJournal.push({ eventId: 'evt-cmd-1-inspection', seq: 2, worldTimeMinutes: 0,
      type: 'FixtureRecorded', actorId: null, targetIds: [], payload: {}, visibility: 'private' });
    const engine = createEngine(world); const before = engine.snapshot(); const command = inspect('cmd-1', world.campaign.worldRevision);
    expect(engine.dispatch(command)).toEqual({ ok: false, code: 'settlement_failed' });
    expect(engine.dispatch(command)).toEqual({ ok: false, code: 'settlement_failed' }); expect(engine.snapshot()).toBe(before);
    if (kind === 'event') expect(engine.dispatch(inspect('cmd-2')).ok).toBe(true);
  });
  it.each(['version', 'time-version', 'appearance', 'target', 'knowledge', 'time', 'event-id', 'private', 'orphan', 'duplicate', 'light', 'initial-evidence'])('rejects corrupt %s in mixed snapshot reconstruction', kind => {
    const engine = createEngine(inspectionScene()); expect(engine.dispatch(inspect()).ok).toBe(true);
    expect(engine.dispatch(observe('cmd-2', 1)).ok).toBe(true);
    const world = mutableJson(engine.snapshot());
    if (kind === 'version') world.eventJournal[2].payload.rule = 'inspect-v99';
    if (kind === 'time-version') world.eventJournal[1].payload.rule = 'observe-v1';
    if (kind === 'appearance') world.eventJournal[2].payload.appearance = 'SECRET_appearance';
    if (kind === 'target') world.eventJournal[2].payload.request.itemId = 'missing';
    if (kind === 'knowledge') world.knowledge.find((k: { factId: string }) => k.factId.startsWith('inspection-')).source = 'forged';
    if (kind === 'time') world.eventJournal[1].payload.fromMinutes = 1;
    if (kind === 'event-id') world.eventJournal[2].eventId = 'evt-wrong';
    if (kind === 'private') world.eventJournal[2].visibility = 'public';
    if (kind === 'orphan') world.eventJournal[1].type = 'FixtureRecorded';
    if (kind === 'duplicate') { world.eventJournal[3].payload.commandId = 'cmd-1'; world.eventJournal[4].payload.commandId = 'cmd-1'; }
    if (kind === 'light') world.locations['location-1'].light = 0;
    if (kind === 'initial-evidence') world.eventJournal[0].payload.rule = 'initial-sight-v2';
    expect(() => createEngine(world)).toThrow();
  });
  it('continues accepting old G0 empty journals and observe-v1 only snapshots', () => {
    const engine = createEngine(scene(1)); expect(engine.dispatch(observe()).ok).toBe(true);
    const old = mutableJson(engine.snapshot());
    expect(old.eventJournal[1].payload).toEqual({ rule: 'observe-v1', commandId: 'cmd-1',
      request: { actorId: 'player-1', locationId: 'location-1', expectedWorldRevision: 0 },
      visibility: 'clear', elapsedMinutes: 1, committedRevision: 1, observedAt: 1 });
    expect(createEngine(old).dispatch(observe())).toMatchObject({ ok: true, replayed: true });
  });
  it('returns only controlled appearance/targets and truthful unsaved feedback; hidden probes are indistinguishable', async () => {
    const world = inspectionScene(); world.items.hidden = { ...world.items['tin-1'], itemId: 'hidden', metadata: { secret: 'SECRET_hidden' } };
    const game = createGame(world); expect(Object.keys(game)).toEqual(['dispatch']);
    const reply = await game.dispatch(inspect());
    expect(reply).toMatchObject({ ok: true, clock: { gameClockMinutes: 1 }, inspectTargets: [{ targetId: 'tin-1', label: '空罐' }],
      outcome: { facts: [{ factId: 'inspection-appearance', description: '罐身呈金属质感，罐口敞开。' }] }, persistence: { ok: false, code: 'not_implemented' } });
    expect(JSON.stringify(reply)).not.toMatch(/SECRET|empty-tin|metadata|condition|durability|worldState|eventJournal|hidden/);
    const hidden = await game.dispatch(inspect('probe', 1, 'hidden'));
    expect(hidden).toEqual(await game.dispatch(inspect('probe', 1, 'missing')));
    expect(hidden).toEqual({ ok: false, code: 'invalid_target' });
  });
});
