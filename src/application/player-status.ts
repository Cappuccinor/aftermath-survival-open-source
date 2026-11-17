import type { WorldState } from '../core/world';
import type { VisiblePlayerStatus } from './ports';

const boundedKeys = ['hp', 'stamina', 'mental', 'hunger', 'thirst', 'fatigue', 'infection', 'pain'] as const;
const keys = [...boundedKeys, 'bodyTempC', 'carryWeightKg'] as const;

/** Copy only own numeric data properties. An unavailable projection never invents values. */
export function copyPlayerStatus(input: unknown): VisiblePlayerStatus | null {
  try {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
    const values = {} as Record<keyof VisiblePlayerStatus, number>;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
      const value: unknown = descriptor.value;
      if (typeof value !== 'number' || !Number.isFinite(value)) return null;
      if (key !== 'bodyTempC' && value < 0) return null;
      if (key !== 'bodyTempC' && key !== 'carryWeightKg' && value > 100) return null;
      values[key] = value;
    }
    return Object.freeze(values);
  } catch {
    // A hostile/revoked proxy is unavailable, not a failed or retryable world action.
    return null;
  }
}

/** Trusted world boundary. A malformed world is a programming error, not full health. */
export function projectPlayerStatus(world: WorldState): VisiblePlayerStatus {
  const status = copyPlayerStatus(world.player.stats);
  if (status === null) throw new Error('Invalid authoritative player status');
  return status;
}
