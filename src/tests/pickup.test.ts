import { describe, expect, test } from 'vitest';
import { createEngine } from '../core/engine';
import { parseWorldState } from '../core/world';
import { createPickupPrototype, addPickupScope, createPickupGame } from '../core/pickup-prototype';
import { createDoorPrototype, createDoorGame } from '../core/door-prototype';
import { canPickUp, visiblePickupTargets } from '../core/pickup';
import { visibleInspectionTargets } from '../core/inspection';
import { readCharacterProfile } from '../core/character';
import { doorCharacter, doorMetadata } from './door-fixtures';
import { action, clone, corridor, discovered, pickupCommand, room, tin } from './pickup-fixtures';

test('independent new factories preserve old semantics and have no automatic action or knowledge', () => {
  const old = createDoorPrototype(); expect(old.eventJournal.some(e => e.type === 'PickupScopeInitialized')).toBe(false);
  expect(createEngine(old).dispatch(pickupCommand(0))).toMatchObject({ ok: false });
  const world = createPickupPrototype(); expect(world.campaign.worldRevision).toBe(0);
  expect(world.items).toEqual(old.items); expect(world.rngState).toEqual(old.rngState); expect(world.npcs).toEqual(old.npcs);
  expect(visiblePickupTargets(world)).toEqual([]); expect(world.knowledge).toEqual(old.knowledge);
  expect(() => addPickupScope(world)).toThrow(); expect(() => addPickupScope(discovered().snapshot())).toThrow();
  expect(createDoorGame(doorCharacter, doorMetadata).eventJournal.some(e => e.type === 'PickupScopeInitialized')).toBe(false);
  expect(readCharacterProfile(createPickupGame(doorCharacter, doorMetadata))).toEqual(doorCharacter);
});

test('search, inspect, pickup transfers same item once; current proposals vanish, re-search/return cannot respawn', () => {
  const engine = discovered(); expect(visiblePickupTargets(engine.snapshot())).toEqual([{ targetId: tin, label: '空罐' }]);
  expect(engine.dispatch(action('inspect', 1, tin)).ok).toBe(true);
  const before = engine.snapshot(), cmd = pickupCommand(2), result = engine.dispatch(cmd);
  expect(result).toMatchObject({ ok: true, replayed: false, receipt: { rule: 'pick_up-v1', beforeCarryWeightKg: 0, afterCarryWeightKg: .05 } });
  const after = engine.snapshot(); expect(after.items[tin]).toEqual({ ...before.items[tin], position: { kind: 'player', id: before.player.playerId } });
  expect(after.player.stats).toEqual({ ...before.player.stats, carryWeightKg: .05 });
  expect(after.player.locationId).toBe(room); expect(after.player.skills).toEqual(before.player.skills);
  expect(after.rngState).toEqual(before.rngState); expect(after.npcs).toEqual(before.npcs);
  expect(after.campaign.gameClockMinutes).toBe(3); expect(after.eventJournal.slice(-2).map(e => e.type)).toEqual(['TimeAdvanced','ItemPickedUp']);
  expect(after.knowledge.filter(k => k.factId !== `pickup-${tin}`)).toEqual(before.knowledge);
  expect(visiblePickupTargets(after)).toEqual([]); expect(visibleInspectionTargets(after)).toEqual([]);
  expect(engine.dispatch(cmd)).toMatchObject({ ok: true, replayed: true }); expect(engine.snapshot()).toBe(after);
  expect(engine.dispatch(pickupCommand(3))).toEqual({ ok: false, code: 'invalid_target' }); expect(engine.snapshot()).toBe(after);
  expect(engine.dispatch(action('search',3,room))).toMatchObject({ok:true,receipt:{discoveredItemId:null}});
  expect(engine.dispatch(action('move',4,corridor)).ok).toBe(true);
  expect(engine.dispatch(cmd)).toMatchObject({ok:true,replayed:true});
  expect(engine.dispatch(action('move',5,room)).ok).toBe(true);
  expect(visiblePickupTargets(engine.snapshot())).toEqual([]); expect(visibleInspectionTargets(engine.snapshot())).toEqual([]);
  expect(Object.keys(engine.snapshot().items)).toEqual([tin]); expect(engine.snapshot().player.stats.carryWeightKg).toBe(.05);
});

describe('rejections do not alter any state, RNG or command reservation', () => {
  test('undiscovered, dark, remote and dead', () => {
    const initial=createPickupPrototype(); const cases: any[]=[initial];
    const dark:any=clone(initial); dark.locations[room].light=.49; cases.push(dark);
    const formerlyLit:any=clone(discovered().snapshot()); formerlyLit.locations[room].light=.49;
    expect(canPickUp(formerlyLit,tin)).toBe(false);
    expect(()=>createEngine(formerlyLit)).toThrow(); // Old search history still requires its static light.
    const dead:any=clone(discovered().snapshot()); dead.player.stats.hp=0; cases.push(dead);
    const remote=discovered(); remote.dispatch(action('move',1,corridor)); cases.push(remote.snapshot());
    for(const state of cases){const e=createEngine(state),before=e.snapshot();expect(e.dispatch(pickupCommand(before.campaign.worldRevision))).toMatchObject({ok:false});expect(e.snapshot()).toBe(before);}
  });
  test.each([
    ['unknown',{targetIds:['unknown']}],['npc',{targetIds:['prototype-witness']}],['missing',{targetIds:[]}],['multi',{targetIds:[tin,room]}],
    ['tool',{toolIds:[tin]}],['quantity',{arguments:{count:1}}],['actor',{actorId:'other'}],['stale',{expectedWorldRevision:0}],
  ])('%s',(_name,change)=>{const e=discovered(),before=e.snapshot();expect(e.dispatch({...pickupCommand(),...change})).toMatchObject({ok:false});expect(e.snapshot()).toBe(before);expect(e.dispatch(pickupCommand()).ok).toBe(true);});
  test('candidate event collision retains whole reference and command ID can be used by another legal primitive',()=>{
    const w:any=clone(discovered().snapshot()); w.eventJournal.push({eventId:'evt-collision-pickup',seq:w.eventJournal.length+1,type:'FixtureCollision',worldTimeMinutes:1,actorId:null,targetIds:[],visibility:'private',payload:{}});
    const e=createEngine(w),before=e.snapshot();expect(e.dispatch(pickupCommand(1,'collision'))).toEqual({ok:false,code:'settlement_failed'});expect(e.snapshot()).toBe(before);
    expect(e.dispatch({...action('observe',1),commandId:'collision'}).ok).toBe(true);
  });
  test.each([{targetIds:[room]},{expectedWorldRevision:2},{verb:'inspect'},{arguments:{count:1}},{actorId:'other'}])('same ID altered request refuses %j',change=>{
    const e=discovered(),cmd=pickupCommand();expect(e.dispatch(cmd).ok).toBe(true);const before=e.snapshot();expect(e.dispatch({...cmd,...change})).toMatchObject({ok:false});expect(e.snapshot()).toBe(before);
  });
});

test('24 successful mixed actions reconstruct and replay every old ID without divergence, two worlds isolated',()=>{
  const initial=createPickupGame(doorCharacter,doorMetadata),other=createEngine(createPickupGame(doorCharacter,{...doorMetadata,saveId:'other',playerId:'other-player'}));
  const otherBefore=other.snapshot();let e=createEngine(initial);const commands:any[]=[];
  const steps:[string,string?][]=[['search',room],['inspect',tin],['observe','prototype-door-gap'],['pick_up',tin],['search',room],['move',corridor],['observe'],['move',room]];
  while(steps.length<24) steps.push(...[['observe','prototype-door-gap'],['search',room],['move',corridor],['observe'],['move',room]] as [string,string?][]);
  for(const [n,[verb,target]] of steps.slice(0,24).entries()){
    const cmd=action(verb,n,target,initial.player.playerId);commands.push(cmd);expect(e.dispatch(cmd).ok).toBe(true);
    const committed=e.snapshot();e=createEngine(clone(committed));expect(e.snapshot()).toEqual(committed);
    for(const prior of commands){expect(e.dispatch(prior)).toMatchObject({ok:true,replayed:true});expect(e.snapshot()).toEqual(committed);}
    expect(readCharacterProfile(committed)).toEqual(doorCharacter);expect(Object.keys(committed.items)).toEqual([tin]);
    expect(committed.items[tin]!.count).toBe(1);expect(committed.player.stats.carryWeightKg).toBe(n>=3?.05:0);
    expect(committed.campaign.worldRevision).toBe(n+1);expect(other.snapshot()).toBe(otherBefore);
  }
  expect(()=>parseWorldState(clone(e.snapshot()))).not.toThrow();
});
