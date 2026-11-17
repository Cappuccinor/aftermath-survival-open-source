import { expect, test, vi } from 'vitest';
import { copySceneContext, projectSceneContext } from '../application/scene-context';
import { createGame } from '../application/game';
import { createCharacterCreation } from '../application/character-creation';
import { createBuildingPrototype, addBuildingScene } from '../core/building-prototype';
import { addPickupScope, createPickupPrototype } from '../core/pickup-prototype';
import { doorFixture } from './door-fixtures';
import { createEngine } from '../core/engine';
import { action, clone, room, corridor, tin } from './pickup-fixtures';
import type { StartedGame } from '../application/ports';

const initial = { scene: 'abandoned-residential-building-v1', locationId: room, locationRole: 'room', light: 'clear' } as const;
test('public context is exactly four controlled fields, frozen and independent of world aliases; old world null', () => {
  const world = createBuildingPrototype(), before = JSON.stringify(world);
  const view = projectSceneContext(world);
  expect(view).toEqual(initial); expect(Object.isFrozen(view)).toBe(true);
  expect(Reflect.set(view!, 'light', 'dim')).toBe(false);
  for (let n = 0; n < 10; n++) expect(projectSceneContext(world)).toEqual(initial);
  expect(JSON.stringify(world)).toBe(before); expect(projectSceneContext(createPickupPrototype())).toBeNull();
  expect(JSON.stringify(view)).not.toMatch(/tin|npc|witness|alert|source|metadata|knowledge|rng|安全|空罐|武器/i);
});
test.each([0, .49, .5, 1])('scene uses actual room/corridor light %s and explicit current role', light => {
  const w: any = clone(addPickupScope(doorFixture(35, { light })));
  w.locations[room].light = light;
  const e = createEngine(addBuildingScene(w));
  expect(projectSceneContext(e.snapshot())).toMatchObject({ locationRole: 'room', light: light >= .5 ? 'clear' : 'dim' });
  expect(e.dispatch(action('move', 0, corridor)).ok).toBe(true);
  expect(projectSceneContext(e.snapshot())).toMatchObject({ locationId: corridor, locationRole: 'corridor', light: light >= .5 ? 'clear' : 'dim' });
});
test.each([undefined, null, [], {}, { ...initial, scene: 'other' }, { ...initial, locationRole: 'roof' },
  { ...initial, light: 'safe' }, { ...initial, locationId: '' }, { ...initial, text: '十把枪' }, Object.create(initial)])('invalid or absent context is unavailable: %#', value => {
  expect(copySceneContext(value)).toBeNull();
});
test('context copy rejects accessor/revoked values without evaluating getters, mismatched public location; safe copy is independent', () => {
  const getter = vi.fn(() => 'clear'); const accessed = { ...initial }; Object.defineProperty(accessed, 'light', { get: getter });
  expect(copySceneContext(accessed)).toBeNull(); expect(getter).not.toHaveBeenCalled();
  const proxy = Proxy.revocable({}, {}); proxy.revoke(); expect(copySceneContext(proxy.proxy)).toBeNull();
  expect(copySceneContext(initial, null)).toBeNull();
  expect(copySceneContext(initial, { targetId: corridor, label: '走廊' })).toBeNull();
  expect(copySceneContext(initial, { targetId: room, label: '走廊' })).toBeNull();
  const input: any = { ...initial }, copied = copySceneContext(input, { targetId: room, label: '房间' }); input.light = 'dim';
  expect(copied).toEqual(initial); expect(copied).not.toBe(input);
});
test('current context follows movement while replayed result and old action summary remain original; no pickup disclosure', async () => {
  const game = createGame(createBuildingPrototype()); const c = action('observe', 0), r = await game.dispatch(c);
  expect(r).toMatchObject({ ok: true, sceneContext: initial });
  if (!r.ok) throw Error('observe failed');
  expect(r.outcome.summary).toBe('你留在原地，仔细观察了一分钟。光线足够，你能分辨周围的明暗。');
  const moved = await game.dispatch(action('move', 1, corridor));
  expect(moved).toMatchObject({ ok: true, sceneContext: { locationId: corridor, locationRole: 'corridor', light: 'dim' } });
  const replay = await game.dispatch(c);
  expect(replay).toMatchObject({ ok: true, replayed: true, outcome: r.outcome, sceneContext: { locationId: corridor }, inventory: [] });
  expect(await game.dispatch(action('pick_up', 2, tin))).toMatchObject({ ok: false });
});
test('new preview opts into building start without invoking factory; old preview stays room, cancel and confirm-once preserved', () => {
  const create = vi.fn(() => ({ session: {} as StartedGame['session'], character: null }));
  for (const place of ['room', 'building-room'] as const) {
    create.mockClear(); const creation = createCharacterCreation({ create, prototype: create }, place);
    const draft: any = clone(creation.read().draft); draft.profile.name = '楼中人'; creation.update(draft); creation.preview();
    expect(creation.read().preview?.locationLabel).toBe(place === 'room' ? '房间' : '废弃居民楼 · 房间');
    expect(create).not.toHaveBeenCalled(); creation.cancel(); expect(creation.read().draft).toEqual(draft);
    creation.preview(); const started = creation.start(); expect(started).not.toBeNull(); expect(creation.start()).toBe(started);
    expect(creation.startPrototype()).toBe(started); expect(create).toHaveBeenCalledTimes(1);
  }
});
