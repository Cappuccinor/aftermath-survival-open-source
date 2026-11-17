import { describe, expect, it } from 'vitest';
import { createWorldState, parseWorldState, getWorldTime } from '../core/world';
import { initialInput, mutableJson } from './fixtures';

describe('G0-WORLD: initial state and invariants (not full CORE-01)', () => {
  it('constructs the declared baseline with explicit identity, time and seed', () => {
    const world = createWorldState(initialInput);
    expect(world).toEqual({
      stateSchema: 'g0-world-v1',
      campaign: {
        saveId: 'save-1', schemaVersion: null, difficulty: 'test_fixture', seed: 1,
        createdAt: '2026-10-23T00:00:00.000Z', gameClockMinutes: 0,
        worldRevision: 0, offlineProgressionEnabled: false,
      },
      player: {
        playerId: 'player-1', background: '', locationId: 'location-1',
        stats: { hp: 100, stamina: 100, mental: 100, hunger: 0, thirst: 0,
          fatigue: 0, infection: 0, pain: 0, bodyTempC: 37, carryWeightKg: 0 },
        skills: {}, knownFactIds: [],
      },
      locations: { 'location-1': { locationId: 'location-1', name: 'G0 测试地点',
        adjacentLocationIds: [], light: 0, searched: false } },
      items: {}, knowledge: [], npcs: [], relationships: [], factions: [],
      bases: [], vehicles: [], jobs: [], eventJournal: [],
      rngState: { algorithm: 'xorshift32-v1', state: 1 },
    });
    expect(createWorldState(initialInput)).toEqual(world);
    expect(parseWorldState(mutableJson(world))).toEqual(world);
  });
  it('derives both day counters from a single elapsed-minute clock', () => {
    expect(getWorldTime(0)).toEqual({ worldDay: 1, apocalypseDay: 30, hour: 8, minute: 0 });
    expect(getWorldTime(959)).toEqual({ worldDay: 1, apocalypseDay: 30, hour: 23, minute: 59 });
    expect(getWorldTime(960)).toEqual({ worldDay: 2, apocalypseDay: 31, hour: 0, minute: 0 });
    expect(getWorldTime(1440)).toEqual({ worldDay: 2, apocalypseDay: 31, hour: 8, minute: 0 });
    expect(() => getWorldTime(-1)).toThrow();
    expect(() => getWorldTime(Number.MAX_SAFE_INTEGER)).toThrow();
  });
  it('returns deeply immutable, independent snapshots with no input aliases', () => {
    const first = createWorldState(initialInput);
    const second = createWorldState(initialInput);
    expect(first.player).not.toBe(second.player);
    expect(first.locations).not.toBe(second.locations);
    expect(Reflect.set(first.player.stats, 'hp', 0)).toBe(false);
    expect(Reflect.set(first.items, 'forged', {})).toBe(false);
    expect(() => (first.eventJournal as unknown[]).push({})).toThrow();
    expect(second.player.stats.hp).toBe(100);
    const input = mutableJson(first);
    const parsed = parseWorldState(input);
    input.player.stats.hp = 0;
    expect(parsed.player.stats.hp).toBe(100);
  });
  it.each([
    { seed: 0 }, { seed: 1.2 }, { playerId: '' }, { locationId: 'player-1' },
    { playerId: '__proto__' }, { playerId: 'constructor' },
    { createdAt: 'yesterday' }, { createdAt: '2026-02-30T00:00:00.000Z' },
    { arbitrary: 'do not silently discard' },
  ])('rejects invalid or ambiguous initial input %#', change => {
    expect(() => createWorldState({ ...initialInput, ...change })).toThrow();
  });
  const invalidChanges: [string, (world: any) => void][] = [
    ['dangling player location', w => { w.player.locationId = 'missing'; }],
    ['duplicate entity ID', w => { w.player.playerId = 'location-1'; }],
    ['map key mismatch', w => { w.locations['location-1'].locationId = 'other'; }],
    ['dangling adjacency', w => { w.locations['location-1'].adjacentLocationIds = ['missing']; }],
    ['out-of-range hp', w => { w.player.stats.hp = 101; }],
    ['non-finite temperature', w => { w.player.stats.bodyTempC = NaN; }],
    ['negative weight', w => { w.player.stats.carryWeightKg = -1; }],
    ['fractional clock', w => { w.campaign.gameClockMinutes = 0.5; }],
    ['negative revision', w => { w.campaign.worldRevision = -1; }],
    ['unsafe clock', w => { w.campaign.gameClockMinutes = Number.MAX_SAFE_INTEGER; }],
    ['unknown state version', w => { w.stateSchema = 'future'; }],
    ['unknown property', w => { w.hiddenOverride = true; }],
    ['unimplemented NPC data', w => { w.npcs = [{ npcId: 'npc-1' }]; }],
    ['unearned known fact', w => { w.player.knownFactIds = ['secret']; }],
    ['invalid RNG', w => { w.rngState.state = 0; }],
  ];
  it.each(invalidChanges)('rejects %s', (_, change) => {
    const input = mutableJson(createWorldState(initialInput));
    change(input);
    expect(() => parseWorldState(input)).toThrow();
  });
  it('validates item ownership and rejects multiple positions, negative quantities and cycles', () => {
    const input = mutableJson(createWorldState(initialInput));
    const water = { itemId: 'water-1', typeId: 'water', position: { kind: 'location', id: 'location-1' },
      count: 1, weightKg: 1, durability: 100, condition: 'sealed', metadata: { note: { text: 'test' } } };
    input.items['water-1'] = water;
    const valid = parseWorldState(input);
    expect(valid.items['water-1']?.count).toBe(1);
    expect(Object.isFrozen(valid.items['water-1']?.metadata.note)).toBe(true);
    for (const change of [
      () => { water.count = -1; },
      () => { water.count = 1; water.position.id = 'missing'; },
      () => { water.position = { kind: 'container', id: 'water-1' }; },
      () => { water.position = { kind: 'location', id: 'location-1' }; (water as any).ownerId = 'player-1'; },
    ]) {
      change();
      expect(() => parseWorldState(input)).toThrow();
    }
    const cycle = mutableJson(valid);
    cycle.items['box-1'] = { ...cycle.items['water-1'], itemId: 'box-1', position: { kind: 'container', id: 'water-1' } };
    cycle.items['water-1'].position = { kind: 'container', id: 'box-1' };
    expect(() => parseWorldState(cycle)).toThrow();
  });
  it('checks knowledge ownership, duplicate evidence and observation times', () => {
    const input = mutableJson(createWorldState(initialInput));
    const fact = { knowerId: 'player-1', factId: 'fact-1', source: 'sight', confidence: 1, observedAt: 0 };
    input.knowledge = [fact];
    input.player.knownFactIds = ['fact-1'];
    expect(parseWorldState(input).knowledge).toHaveLength(1);
    fact.knowerId = 'missing';
    expect(() => parseWorldState(input)).toThrow();
    fact.knowerId = 'player-1'; fact.observedAt = 1;
    expect(() => parseWorldState(input)).toThrow();
    fact.observedAt = 0; input.knowledge.push({ ...fact });
    expect(() => parseWorldState(input)).toThrow();
  });
});
