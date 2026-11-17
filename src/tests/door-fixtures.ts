import { createSearchPrototype } from '../core/prototype';
import { addDoorGap } from '../core/door-prototype';
import { createRng } from '../core/rng';
import { mutableJson } from './fixtures';

export const doorId = 'prototype-door-gap';
export function doorCommand(n = 0, commandId = `door-${n}`) {
  return { commandId, actorId: 'prototype-player', source: 'button', verb: 'observe', targetIds: [doorId],
    toolIds: [] as string[], arguments: { through: 'door_gap', careful: true } as Record<string, unknown>,
    utterance: '观察门缝', expectedWorldRevision: n };
}
export function oldCommand(n: number, verb: string, target: string) {
  return { ...doorCommand(n), commandId: `mixed-${n}`, verb, targetIds: [target], arguments: {} };
}
export function doorFixture(seed = 1, options: { light?: number; perception?: number; stealth?: number; hp?: number; gapOpen?: boolean } = {}) {
  const world = mutableJson(createSearchPrototype());
  world.campaign.seed = seed; world.rngState = createRng(seed).snapshot();
  world.player.skills = { perception: options.perception ?? 0, stealth: options.stealth ?? 0 };
  world.player.stats.hp = options.hp ?? 100;
  world.locations['prototype-corridor'].light = options.light ?? 0.2;
  const scoped = mutableJson(addDoorGap(world));
  if (options.gapOpen === false) scoped.eventJournal.find((e: { type: string }) => e.type === 'DoorGapInitialized').payload.gapOpen = false;
  return scoped;
}
export const doorVectors = [
  { seed: 1, visual: 'shoes', noticed: true, visualRoll: 0.00006295018829405308, noticeRoll: 0.015747428173199296, after: 67634689 },
  { seed: 35, visual: 'shoes', noticed: false, visualRoll: 0.0020811560098081827, noticeRoll: 0.5507814076263458, after: 2365588133 },
  { seed: 1472, visual: 'shadow', noticed: true, visualRoll: 0.09266222175210714, noticeRoll: 0.18014350556768477, after: 773710465 },
  { seed: 2944, visual: 'none', noticed: true, visualRoll: 0.1853244435042143, noticeRoll: 0.3602870188187808, after: 1547420963 },
  { seed: 2976, visual: 'none', noticed: false, visualRoll: 0.18733837315812707, noticeRoll: 0.8640640687663108, after: 3711126917 },
] as const;

export const doorCharacter = { profile: { name: '门内角色', age: 28, gender: '', occupation: '木工',
  locationBackground: '远方', bodyCondition: '无敌', personality: '谨慎', strengths: '', weaknesses: '',
  importantItems: '一把枪', companions: '朋友', importantPerson: '家人', fear: '', wish: '活着' },
  skills: { perception: 20, stealth: 20, survival: 20 } };
export const doorMetadata = { seed: 2976, saveId: 'door-created', playerId: 'created-player', createdAt: '2026-10-24T00:00:00.000Z' };
