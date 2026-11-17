import type { WorldState } from '../core/world';
import { readBuildingScene } from '../core/building-scene';
import { idSchema } from '../core/schema';
import type { VisibleSceneContext, VisibleTarget } from './ports';

/** A malformed or mismatched projection is unavailable, never a replacement story. */
export function copySceneContext(input: unknown, location?: VisibleTarget | null): VisibleSceneContext | null {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Reflect.ownKeys(input).length !== 4) return null;
    const fields: Record<string, unknown> = {};
    for (const key of ['scene', 'locationId', 'locationRole', 'light']) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
      fields[key] = descriptor.value;
    }
    if (fields.scene !== 'abandoned-residential-building-v1' || !idSchema.safeParse(fields.locationId).success
      || (fields.locationRole !== 'room' && fields.locationRole !== 'corridor')
      || (fields.light !== 'clear' && fields.light !== 'dim')) return null;
    if (location !== undefined && (!location || location.targetId !== fields.locationId
      || location.label !== (fields.locationRole === 'room' ? '房间' : '走廊'))) return null;
    return Object.freeze({ scene: fields.scene, locationId: fields.locationId as string, locationRole: fields.locationRole, light: fields.light });
  } catch { return null; }
}
export function projectSceneContext(world: WorldState): VisibleSceneContext | null {
  const scope = readBuildingScene(world);
  if (!scope) return null;
  const locationId = world.player.locationId;
  return copySceneContext({ scene: scope.scene, locationId, locationRole: locationId === scope.roomId ? 'room' : 'corridor',
    light: world.locations[locationId]!.light >= .5 ? 'clear' : 'dim' });
}
