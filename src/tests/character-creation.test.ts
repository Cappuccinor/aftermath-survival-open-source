import { expect, it } from 'vitest';
import { createCharacterCreation } from '../application/character-creation';
import { createNewGame } from '../core/new-game';
import { readCharacterProfile } from '../core/character';
import { createGame } from '../application/game';
import { createObservationSession } from '../application/session';
import { projectClock } from '../application/clock';
import { localIntentInterpreter } from '../adapters/ai/local-intent';
import { visibleSearchTargets } from '../core/search';
import { createSearchPrototype } from '../core/prototype';
import type { CharacterCreation, CharacterProfile, StartedGame } from '../application/ports';

function harness() {
  let calls = 0, fail = false, reenter: (() => void) | undefined;
  const create = (input?: CharacterProfile): StartedGame => {
    calls++; reenter?.(); if (fail) throw new Error('session install failure');
    const world = input ? createNewGame(input, { seed: 1, saveId: 'app-world', playerId: 'app-player', createdAt: '2026-10-24T00:00:00.000Z' }) : createSearchPrototype();
    return { character: readCharacterProfile(world), session: createObservationSession({ client: createGame(world), interpreter: localIntentInterpreter,
      actorId: world.player.playerId, initialClock: projectClock(world), initialSearchTargets: visibleSearchTargets(world) }) };
  };
  const app = createCharacterCreation({ create, prototype: () => create() });
  const draft = JSON.parse(JSON.stringify(app.read().draft)); draft.profile.name = '林舟';
  return { app, draft, calls: () => calls, fail: (v: boolean) => fail = v, reenter: (fn: () => void) => reenter = fn };
}
it('previews exact initial state without creating; cancel/edit retain raw draft', () => {
  const h = harness(); expect(h.app.read().draft.skills).toEqual({ perception: '20', stealth: '20', survival: '20' });
  expect(h.app.start()).toBeNull(); expect(h.calls()).toBe(0);
  h.draft.profile.name = '  林舟  '; h.draft.profile.wish = '<img src=x onerror=alert(1)>\n守住家';
  h.app.update(h.draft); h.app.preview();
  expect(h.app.read().phase).toBe('preview'); expect(h.calls()).toBe(0);
  expect(h.app.read().preview).toMatchObject({ character: { profile: { name: '林舟', wish: h.draft.profile.wish }, skills: { perception: 20, stealth: 20, survival: 20 } }, locationLabel: '房间', clockLabel: '生存第 1 天 · 08:00 · 灾变第 30 天', stats: { hp: 100, bodyTempC: 37 } });
  h.app.edit(); expect(h.app.read().preview).toBeNull(); h.app.preview(); h.app.cancel();
  expect(h.app.read().draft).toEqual(h.draft); expect(h.calls()).toBe(0); expect(h.app.start()).toBeNull();
});
it.each(['','-1','1.5','31','NaN','Infinity','2e1','0x14'])('rejects malformed or out-of-range skill %s and keeps draft', skill => {
  const h = harness(); h.draft.skills.perception = skill; h.app.update(h.draft); h.app.preview();
  expect(h.app.read().phase).toBe('error'); expect(h.app.read().draft).toEqual(h.draft); expect(h.app.read().errors.length).toBeGreaterThan(0);
  expect(h.app.start()).toBeNull(); expect(h.calls()).toBe(0);
});
it.each(['extra','budget','age','type','inherited'])('rejects %s form injection', mode => {
  const h = harness();
  if (mode === 'extra') h.draft.locationId = 'secret';
  if (mode === 'budget') h.draft.skills.perception = '21';
  if (mode === 'age') h.draft.profile.age = '121';
  if (mode === 'type') h.draft.profile.wish = 7;
  if (mode === 'inherited') h.draft.profile = Object.create(h.draft.profile);
  h.app.update(h.draft); h.app.preview(); expect(h.app.read().phase).toBe('error'); expect(h.calls()).toBe(0);
});
it('requires another preview after edits and cannot alias committed identity', () => {
  const h = harness(); h.app.update(h.draft); h.app.preview(); h.draft.profile.name = '新名字'; h.app.update(h.draft);
  expect(h.app.start()).toBeNull(); expect(h.calls()).toBe(0);
  h.app.preview(); const active = h.app.start()!; expect(active.character!.profile.name).toBe('新名字');
  h.draft.profile.name = '篡改'; h.app.update(h.draft); h.app.cancel();
  expect(h.app.start()).toBe(active); expect(h.app.startPrototype()).toBe(active); expect(h.calls()).toBe(1);
  expect(Reflect.set(active.character!.profile, 'name', '篡改')).toBe(false);
  expect(Object.keys(active).sort()).toEqual(['character', 'session']);
  expect(JSON.stringify(active.character)).not.toMatch(/rngState|eventJournal|knowledge|prototype-tin|locationId|metadata/);
});
it('recovers from initialization/session failure without losing preview or draft', () => {
  const h = harness(); h.app.update(h.draft); h.app.preview(); h.fail(true);
  expect(h.app.start()).toBeNull(); expect(h.app.read()).toMatchObject({ phase: 'error', draft: h.draft, started: null });
  expect(h.app.read().preview).not.toBeNull(); h.fail(false);
  expect(h.app.start()).not.toBeNull(); expect(h.calls()).toBe(2); expect(h.app.read().phase).toBe('started');
});
it('locks both entry points before invoking a reentrant factory and installs once', () => {
  const h = harness(); h.app.update(h.draft); h.app.preview();
  h.reenter(() => { expect(h.app.read().phase).toBe('starting'); expect(h.app.start()).toBeNull(); expect(h.app.startPrototype()).toBeNull(); h.app.cancel(); });
  expect(h.app.start()).not.toBeNull(); expect(h.calls()).toBe(1);
});
it('prototype uses the same single-install lock and its failure can recover', () => {
  const h = harness(); h.fail(true); expect(h.app.startPrototype()).toBeNull(); expect(h.app.read().started).toBeNull();
  h.fail(false); const active = h.app.startPrototype()!; expect(active.character).toBeNull();
  h.app.update(h.draft); h.app.preview(); expect(h.app.start()).toBe(active); expect(h.calls()).toBe(2);
});
it('created session dispatches through the real gateway and preserves self profile', async () => {
  const h = harness(); h.app.update(h.draft); h.app.preview(); const active = h.app.start()!;
  await active.session.search('prototype-location'); expect(active.session.read().clock.gameClockMinutes).toBe(1);
  expect(active.session.read().inspectTargets).toEqual([{ targetId: 'prototype-tin', label: '空罐' }]);
  expect(active.character!.profile.name).toBe('林舟'); expect(h.app.read().started).toBe(active);
});
