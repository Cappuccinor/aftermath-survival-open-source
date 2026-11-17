import { expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { parseCharacterInput, readCharacterProfile } from '../core/character';
import { createNewGame } from '../core/new-game';
import { createEngine } from '../core/engine';
import { createInspectionPrototype, createMovementPrototype, createSearchPrototype } from '../core/prototype';
import { parseWorldState } from '../core/world';
import { visibleInspectionTargets } from '../core/inspection';

export const characterInput = () => ({ profile: {
  name: '  林舟  ', age: 28, gender: '自由填写', occupation: '医师\n木工',
  locationBackground: '任意地图', bodyCondition: '我无敌', personality: '谨慎',
  strengths: '全部精通', weaknesses: '', importantItems: '十把枪', companions: '同伴杀光敌人',
  importantPerson: '家人', fear: '失去记忆', wish: '<script>alert(1)</script>',
}, skills: { perception: 20, stealth: 20, survival: 20 } });
export const metadata = { seed: 9, saveId: 'new-world', playerId: 'new-player', createdAt: '2026-10-24T00:00:00.000Z' };
const clone = (x: unknown): any => JSON.parse(JSON.stringify(x));

it('stores all fourteen fields structurally without granting background powers', () => {
  const input = characterInput(), world = createNewGame(input, metadata);
  expect(readCharacterProfile(world)).toEqual({ profile: { ...input.profile, name: '林舟' }, skills: input.skills });
  expect(world.player.background).toBe('');
  expect(world.player.locationId).toBe('prototype-location');
  expect(world.player.stats).toEqual({ hp: 100, stamina: 100, mental: 100, hunger: 0, thirst: 0, fatigue: 0, infection: 0, pain: 0, bodyTempC: 37, carryWeightKg: 0 });
  expect(world.npcs).toEqual([]); expect(Object.keys(world.items)).toEqual(['prototype-tin']);
  expect(world.items['prototype-tin']?.position).toEqual({ kind: 'location', id: 'prototype-location' });
  expect(visibleInspectionTargets(world)).toEqual([]);
  expect(world.campaign).toMatchObject({ seed: 9, saveId: 'new-world', schemaVersion: null, gameClockMinutes: 0, worldRevision: 0 });
  expect(world.rngState.state).toBe(9);
  expect(world.eventJournal.map(e => e.type)).toEqual(['CharacterCreated', 'KnownRouteInitialized', 'SearchScopeInitialized']);
  expect(createNewGame(input, metadata)).toEqual(world);
  expect(createEngine(clone(world)).snapshot()).toEqual(world);
  input.profile.name = '篡改'; input.skills.perception = 0;
  expect(readCharacterProfile(world)?.profile.name).toBe('林舟');
  expect(Reflect.set(readCharacterProfile(world)!.profile, 'name', '改名')).toBe(false);
});

it.each([1, 120])('accepts age boundary %s and empty optional fields', age => {
  const input = characterInput();
  for (const key of Object.keys(input.profile)) if (key !== 'name' && key !== 'age') (input.profile as any)[key] = '';
  input.profile.age = age;
  expect(parseCharacterInput(input).profile.age).toBe(age);
});
it('counts code points rather than UTF16 units and preserves internal newlines', () => {
  const input = characterInput(); input.profile.name = '😀'.repeat(40); input.profile.wish = '😀'.repeat(238) + '\n中';
  expect(parseCharacterInput(input)).toEqual(input);
  input.profile.name += '甲'; expect(() => parseCharacterInput(input)).toThrow();
  input.profile.name = '林'; input.profile.wish += '乙'; expect(() => parseCharacterInput(input)).toThrow();
});
it.each([-1, 0, 121, 1.5, NaN, Infinity, '28', null])('rejects invalid age %s', age => {
  const input = clone(characterInput()); input.profile.age = age; expect(() => parseCharacterInput(input)).toThrow();
});
it.each(['', '   ', '中'.repeat(41), 123, null])('rejects invalid name %#', name => {
  const input = clone(characterInput()); input.profile.name = name; expect(() => parseCharacterInput(input)).toThrow();
});
it.each(['gender','occupation','locationBackground','bodyCondition','personality','strengths','weaknesses','importantItems','companions','importantPerson','fear','wish'])('validates text field %s without truncation', key => {
  const input = clone(characterInput()); input.profile[key] = '中'.repeat(240); expect(() => parseCharacterInput(input)).not.toThrow();
  input.profile[key] += '中'; expect(() => parseCharacterInput(input)).toThrow();
  input.profile[key] = 42; expect(() => parseCharacterInput(input)).toThrow();
});
it.each([-1, 0.5, 31, NaN, Infinity, '20', null])('rejects invalid skill %s', value => {
  const input = clone(characterInput()); input.skills.perception = value; expect(() => parseCharacterInput(input)).toThrow();
});
it('enforces exact budget and keys, allowing zero allocations', () => {
  const input = characterInput(); input.skills = { perception: 30, stealth: 30, survival: 0 }; expect(parseCharacterInput(input).skills).toEqual(input.skills);
  input.skills.survival = 1; expect(() => parseCharacterInput(input)).toThrow();
  input.skills = { perception: 0, stealth: 0, survival: 0 }; expect(() => parseCharacterInput(input)).not.toThrow();
  expect(() => parseCharacterInput({ ...input, skills: { ...input.skills, combat: 1 } })).toThrow();
  expect(() => parseCharacterInput({ ...input, locationId: 'secret' })).toThrow();
  expect(() => parseCharacterInput({ ...input, profile: { ...input.profile, hp: 100 } })).toThrow();
  expect(() => parseCharacterInput(Object.create(input))).toThrow();
  expect(() => parseCharacterInput({ ...input, profile: Object.create(input.profile) })).toThrow();
});
it.each([{ seed: 0 }, { seed: 0.1 }, { locationId: 'secret' }, { playerId: 'prototype-tin' }, { createdAt: 'bad' }])('rejects invalid trusted metadata %# without changing input', change => {
  const input = characterInput(), before = clone(input);
  expect(() => createNewGame(input, { ...metadata, ...change })).toThrow(); expect(input).toEqual(before);
});

it.each(['version','rule','extra','age','name','budget','actor','target','visibility','time','duplicate','order','type','id','stats','skills','background','start','initialStats'])('rejects damaged %s creation record on parsing and engine restore', mode => {
  const w = clone(createNewGame(characterInput(), metadata)); const e = w.eventJournal[0];
  if (mode === 'version') e.payload.rule = 'character-created-v2';
  if (mode === 'rule') e.payload.initialRule = 'cheat-v1';
  if (mode === 'extra') e.payload.hp = 999;
  if (mode === 'age') e.payload.profile.age = 0;
  if (mode === 'name') e.payload.profile.name = ' untrimmed ';
  if (mode === 'budget') e.payload.skills.perception = 21;
  if (mode === 'actor') e.actorId = null;
  if (mode === 'target') e.targetIds = ['prototype-location'];
  if (mode === 'visibility') e.visibility = 'public';
  if (mode === 'time') { e.worldTimeMinutes = 1; w.campaign.gameClockMinutes = 1; }
  if (mode === 'duplicate') w.eventJournal.push({ ...e, eventId: 'duplicate', seq: 4 });
  if (mode === 'order') { w.eventJournal.reverse(); w.eventJournal.forEach((x: any, i: number) => x.seq = i + 1); }
  if (mode === 'type') e.type = 'Unknown';
  if (mode === 'id') e.eventId = 'other';
  if (mode === 'stats') w.player.stats.hp = 99;
  if (mode === 'skills') w.player.skills.perception = 19;
  if (mode === 'background') w.player.background = 'shadow profile';
  if (mode === 'start') e.payload.startLocationId = 'prototype-corridor';
  if (mode === 'initialStats') e.payload.initialStats.hp = 99;
  expect(() => parseWorldState(w)).toThrow(); expect(() => createEngine(w)).toThrow();
});
it('accepts every old fixed snapshot and prototype with no character semantics', () => {
  for (const name of readdirSync('src/tests/snapshots').filter(x => x.endsWith('.json'))) {
    const old = JSON.parse(readFileSync(`src/tests/snapshots/${name}`, 'utf8'));
    expect(createEngine(old).snapshot()).toEqual(old); expect(readCharacterProfile(parseWorldState(old))).toBeNull();
  }
  for (const make of [createInspectionPrototype, createMovementPrototype, createSearchPrototype]) {
    const old = make(); expect(readCharacterProfile(old)).toBeNull(); expect(createEngine(old).snapshot()).toEqual(old);
  }
});
it.each(['clock', 'revision'])('rejects unearned %s after character creation', field => {
  const world = clone(createNewGame(characterInput(), metadata));
  world.campaign[field === 'clock' ? 'gameClockMinutes' : 'worldRevision'] = 1;
  expect(() => parseWorldState(world)).toThrow(); expect(() => createEngine(world)).toThrow();
});
it('preserves character across 24 mixed actions, rebuilds and all old retries; isolates identities', () => {
  const initial = createNewGame(characterInput(), metadata); let engine = createEngine(initial);
  const other = createEngine(createNewGame(characterInput(), { ...metadata, saveId: 'other-world', playerId: 'other-player' }));
  const commands: any[] = [];
  for (let n = 0; n < 24; n++) {
    const phase = n % 6, verb = ['search', 'inspect', 'move', 'observe', 'move', 'search'][phase]!;
    const target = phase === 1 ? 'prototype-tin' : phase === 2 || phase === 3 ? 'prototype-corridor' : 'prototype-location';
    const command = { commandId: `created-${n}`, actorId: 'new-player', source: 'button', utterance: '', verb, targetIds: [target], toolIds: [], arguments: {}, expectedWorldRevision: n };
    expect(engine.dispatch(command)).toMatchObject({ ok: true, replayed: false }); commands.push(command);
    engine = createEngine(clone(engine.snapshot())); const before = engine.snapshot();
    for (const old of commands) expect(engine.dispatch(old)).toMatchObject({ ok: true, replayed: true });
    expect(engine.snapshot()).toBe(before); expect(before.campaign.gameClockMinutes).toBe(n + 1);
    expect(readCharacterProfile(before)).toEqual(readCharacterProfile(initial)); expect(before.player.stats).toEqual(initial.player.stats);
    expect(before.items).toEqual(initial.items); expect(before.rngState).toEqual(initial.rngState);
  }
  expect(other.snapshot().campaign.gameClockMinutes).toBe(0); expect(other.snapshot().player.playerId).toBe('other-player');
});
