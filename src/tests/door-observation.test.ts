import { describe, expect, it } from 'vitest';
import { createEngine } from '../core/engine';
import { createDoorPrototype, createDoorGame, addDoorGap } from '../core/door-prototype';
import { judgeDoorObservation, visibleDoorTargets } from '../core/door-observation';
import { createRng } from '../core/rng';
import { createSearchPrototype } from '../core/prototype';
import { createNewGame } from '../core/new-game';
import { mutableJson } from './fixtures';
import { doorCommand, doorFixture, doorId, doorVectors, oldCommand, doorCharacter, doorMetadata } from './door-fixtures';

describe('G1-008: independent door observation', () => {
  it('initializes one real static witness without acting; old factories retain empty NPCs', () => {
    const world = createDoorPrototype();
    expect(world.npcs).toEqual([{ kind: 'g1-door-witness-v1', npcId: 'prototype-witness', locationId: 'prototype-corridor',
      appearance: 'worn-shoes-v1', alertness: 30, firstNoticed: null }]);
    expect(world.campaign).toMatchObject({ worldRevision: 0, gameClockMinutes: 0 });
    expect(world.rngState.state).toBe(1);
    expect(world.eventJournal.filter(e => e.type === 'TimeAdvanced')).toEqual([]);
    expect(visibleDoorTargets(world)).toEqual([{ targetId: doorId, label: '门缝' }]);
    expect(world.items).toEqual(createSearchPrototype().items);
    expect(createSearchPrototype().npcs).toEqual([]);
    expect(createNewGame(doorCharacter, doorMetadata).npcs).toEqual([]);
    expect(createDoorGame(doorCharacter, doorMetadata).player.playerId).toBe(doorMetadata.playerId);
    expect(() => addDoorGap(world)).toThrow();
    const progressed = createEngine(createSearchPrototype()); progressed.dispatch(oldCommand(0, 'observe', 'prototype-location'));
    expect(() => addDoorGap(progressed.snapshot())).toThrow();
  });

  it.each(doorVectors)('seed $seed independently gives $visual / noticed=$noticed', vector => {
    const engine = createEngine(doorFixture(vector.seed)), before = engine.snapshot();
    const result = engine.dispatch(doorCommand());
    expect(result).toMatchObject({ ok: true, replayed: false, receipt: { rule: 'door-observe-v1',
      visual: vector.visual, noticed: vector.noticed, visualRoll: vector.visualRoll, noticeRoll: vector.noticeRoll,
      beforeAlertness: 30, afterAlertness: vector.noticed ? 40 : 30,
      rngBefore: { algorithm: 'xorshift32-v1', state: vector.seed }, rngAfter: { algorithm: 'xorshift32-v1', state: vector.after } } });
    const state = engine.snapshot();
    expect(state.campaign).toMatchObject({ worldRevision: 1, gameClockMinutes: 1 });
    expect(state.rngState.state).toBe(vector.after);
    expect(state.player.stats).toEqual(before.player.stats); expect(state.player.skills).toEqual(before.player.skills);
    expect(state.player.locationId).toBe(before.player.locationId); expect(state.items).toEqual(before.items);
    expect(state.npcs[0]?.alertness).toBe(vector.noticed ? 40 : 30);
    expect(state.eventJournal.slice(before.eventJournal.length).map(e => e.type)).toEqual(vector.noticed
      ? ['TimeAdvanced', 'DoorObservationRecorded', 'NPCAlertnessChanged', 'DoorReactionHeard'] : ['TimeAdvanced', 'DoorObservationRecorded']);
    expect(state.npcs[0]?.firstNoticed).toEqual(vector.noticed ? { playerId: 'prototype-player', locationId: 'prototype-location',
      observedAt: 1, sourceEventId: 'evt-door-0-door-notice' } : null);
    expect(state.knowledge.some(k => k.factId === 'door-heard-door-0')).toBe(vector.noticed);
    expect(before.npcs[0]?.alertness).toBe(30); expect(before.rngState.state).toBe(vector.seed);
    const duplicate = engine.dispatch(doorCommand());
    expect(duplicate).toMatchObject({ ok: true, replayed: true }); expect(engine.snapshot()).toBe(state);
  });

  it('changing perception affects only visual, changing stealth affects only notice, with identical draws', () => {
    const run = (seed: number, options = {}) => createEngine(doorFixture(seed, options)).dispatch(doorCommand());
    const low = run(2944), perception = run(2944, { perception: 100 }), stealth = run(2944, { stealth: 100 });
    expect(low).toMatchObject({ ok: true, receipt: { visual: 'none', noticed: true } });
    expect(perception).toMatchObject({ ok: true, receipt: { visual: 'shoes', noticed: true } });
    expect(stealth).toMatchObject({ ok: true, receipt: { visual: 'none', noticed: false } });
    for (const result of [low, perception, stealth]) expect(result).toMatchObject({ receipt: {
      visualRoll: 0.1853244435042143, noticeRoll: 0.3602870188187808, rngAfter: { state: 1547420963 } } });
  });

  it.each([{ seed: 2281717760, roll: 0.5, visual: 'none' }, { seed: 1140858880, roll: 0.25, visual: 'shadow' }])
    ('uses strict visual thresholds at exactly $roll', ({ seed, roll, visual }) => {
      const result = createEngine(doorFixture(seed, { perception: 40, light: 0.5 })).dispatch(doorCommand());
      expect(result).toMatchObject({ ok: true, receipt: { visualRoll: roll, visual } });
    });

  it('clamps probabilities without inventing certainty at extreme valid attributes', () => {
    const high = judgeDoorObservation({ perception: 100, stealth: 0, corridorLight: 1 }, 100, createRng(14336).snapshot());
    expect(high).toMatchObject({ visualRoll: 0.902455061674118, visual: 'none', noticed: true });
    const low = judgeDoorObservation({ perception: 0, stealth: 100, corridorLight: 0 }, 0, createRng(1).snapshot());
    expect(low).toMatchObject({ noticeRoll: 0.015747428173199296, noticed: true });
    expect(judgeDoorObservation({ perception: 0, stealth: 100, corridorLight: 0 }, 0, createRng(1600).snapshot()))
      .toMatchObject({ visualRoll: 0.10071960929781199, visual: 'none', noticed: false });
    expect(judgeDoorObservation({ perception: 100, stealth: 0, corridorLight: 1 }, 100, createRng(58).snapshot()))
      .toMatchObject({ noticeRoll: 0.912329733138904, noticed: false });
  });

  it('notice uses strict less-than at the exact threshold, independently of visual', () => {
    const result = createEngine(doorFixture(3147338884, { stealth: 10 })).dispatch(doorCommand());
    expect(result).toMatchObject({ ok: true, receipt: { noticeRoll: 0.5, noticed: false, visual: 'none' } });
  });

  it.each(['closed', 'dark', 'dead', 'actor', 'empty', 'many', 'unknown', 'npc', 'remote', 'tools',
    'careless', 'missing-careful', 'extra', 'wrong-through', 'revision'])('rejects %s without random/time/knowledge mutation', mode => {
    const world = doorFixture(2944, { light: mode === 'dark' ? 0.199 : 0.2,
      hp: mode === 'dead' ? 0 : 100, gapOpen: mode !== 'closed' });
    const cmd = doorCommand();
    if (mode === 'actor') cmd.actorId = 'stranger';
    if (mode === 'empty') cmd.targetIds = []; if (mode === 'many') cmd.targetIds.push('prototype-location');
    if (mode === 'unknown') cmd.targetIds = ['unknown']; if (mode === 'npc') cmd.targetIds = ['prototype-witness'];
    if (mode === 'remote') cmd.targetIds = ['prototype-corridor']; if (mode === 'tools') cmd.toolIds = ['tool'];
    if (mode === 'careless') cmd.arguments.careful = false; if (mode === 'missing-careful') delete cmd.arguments.careful;
    if (mode === 'extra') cmd.arguments.cheat = true; if (mode === 'wrong-through') cmd.arguments.through = 'wall';
    if (mode === 'revision') cmd.expectedWorldRevision = 9;
    const engine = createEngine(world), before = engine.snapshot();
    expect(engine.dispatch(cmd).ok).toBe(false); expect(engine.snapshot()).toBe(before);
  });

  it('candidate collision after the two draws rolls back everything and does not reserve command ID', () => {
    const world = doorFixture(2944);
    world.eventJournal.push({ eventId: 'evt-door-0-door', seq: world.eventJournal.length + 1, type: 'Reserved',
      actorId: null, targetIds: [], worldTimeMinutes: 0, visibility: 'private', payload: {} });
    const engine = createEngine(world), before = engine.snapshot();
    expect(engine.dispatch(doorCommand())).toEqual({ ok: false, code: 'settlement_failed' });
    expect(engine.snapshot()).toBe(before);
    // An ordinary observation with the same command ID has different event IDs and can still commit.
    const ordinary = { ...oldCommand(0, 'observe', 'prototype-location'), commandId: 'door-0' };
    expect(engine.dispatch(ordinary)).toMatchObject({ ok: true, replayed: false });
    expect(engine.snapshot().rngState).toEqual(before.rngState);
  });

  it('retries from a different place using the old request; target availability follows current location', () => {
    const engine = createEngine(createDoorPrototype()); const cmd = doorCommand();
    expect(engine.dispatch(cmd).ok).toBe(true);
    expect(engine.dispatch(oldCommand(1, 'move', 'prototype-corridor')).ok).toBe(true);
    const before = engine.snapshot(); expect(visibleDoorTargets(before)).toEqual([]);
    expect(engine.dispatch(cmd)).toMatchObject({ ok: true, replayed: true }); expect(engine.snapshot()).toBe(before);
    expect(engine.dispatch(doorCommand(2))).toEqual({ ok: false, code: 'invalid_target' });
    expect(engine.dispatch(oldCommand(2, 'move', 'prototype-location')).ok).toBe(true);
    expect(visibleDoorTargets(engine.snapshot())).toEqual([{ targetId: doorId, label: '门缝' }]);
  });

  it.each(['ordinary', 'target', 'revision', 'arguments'])('rejects reused door ID with changed %s', mode => {
    const engine = createEngine(createDoorPrototype()), cmd = doorCommand(); engine.dispatch(cmd);
    const changed = mutableJson(cmd);
    if (mode === 'ordinary') { changed.arguments = {}; changed.targetIds = []; }
    if (mode === 'target') changed.targetIds = ['unknown']; if (mode === 'revision') changed.expectedWorldRevision = 1;
    if (mode === 'arguments') changed.arguments.careful = false;
    const before = engine.snapshot(); expect(engine.dispatch(changed).ok).toBe(false); expect(engine.snapshot()).toBe(before);
  });

  it('an old ordinary observe ID cannot be reused as door observation', () => {
    const engine = createEngine(createDoorPrototype()); engine.dispatch({ ...oldCommand(0, 'observe', 'prototype-location'), commandId: 'door-0' });
    const before = engine.snapshot(); expect(engine.dispatch(doorCommand()).ok).toBe(false); expect(engine.snapshot()).toBe(before);
  });

  it('saturates alertness without losing first memory or earlier visual/audio knowledge', () => {
    let engine = createEngine(createDoorPrototype()); let first: unknown; let noticed = 0;
    for (let n = 0; n < 40; n++) {
      const before = engine.snapshot(); const result = engine.dispatch(doorCommand(n));
      expect(result.ok).toBe(true); if (!result.ok || result.receipt.rule !== 'door-observe-v1') throw Error();
      if (result.receipt.noticed) noticed++;
      expect(engine.snapshot().npcs[0]?.alertness).toBe(Math.min(100, 30 + noticed * 10));
      if (first === undefined && result.receipt.noticed) first = engine.snapshot().npcs[0]?.firstNoticed;
      if (first !== undefined) expect(engine.snapshot().npcs[0]?.firstNoticed).toEqual(first);
      for (const fact of before.knowledge) expect(engine.snapshot().knowledge).toContainEqual(fact);
      engine = createEngine(mutableJson(engine.snapshot()));
    }
    expect(noticed).toBeGreaterThan(7); expect(engine.snapshot().npcs[0]?.alertness).toBe(100);
    expect(engine.snapshot().npcs[0]?.locationId).toBe('prototype-corridor');
  });
});
