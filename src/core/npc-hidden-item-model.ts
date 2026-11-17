import { z } from 'zod';
import { idSchema } from './schema';
import { itemSchema } from './item-model';
export const hiddenItemId = 'prototype-hidden-handgun';
export const hiddenItemType = 'hidden-handgun-fixture-v1';
export const hiddenScopeId = 'evt-initial-npc-hidden-item';
export const hiddenScopeSchema = z.strictObject({ rule: z.literal('npc-hidden-item-scope-v1'), playerId: idSchema, npcId: idSchema,
  doorSourceEventId: z.literal('evt-initial-door-gap'), transferSourceEventId: z.literal('evt-initial-transfer'), initialItem: itemSchema });
/** Fixed ownership fixture only; no ammunition, equipment or weapon-use capability. */
export function hiddenItem(npcId: string) {
  return { itemId: hiddenItemId, typeId: hiddenItemType, position: { kind: 'npc' as const, id: npcId },
    count: 1, weightKg: 1, durability: 100, condition: 'concealed', metadata: {} };
}
