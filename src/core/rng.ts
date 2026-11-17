import { z } from 'zod';
import { seedSchema } from './schema';

export const rngStateSchema = z.strictObject({
  algorithm: z.literal('xorshift32-v1'), state: seedSchema,
});
export type RngState = Readonly<z.infer<typeof rngStateSchema>>;
export interface RandomSource {
  nextUint32(): number;
  nextFloat(): number;
  snapshot(): RngState;
}

/** Non-cryptographic rule RNG; zero is rejected rather than silently remapped. */
export function createRng(seed: number): RandomSource {
  let state = seedSchema.parse(seed);
  function nextUint32(): number {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state;
  }
  return Object.freeze({
    nextUint32,
    nextFloat: () => nextUint32() / 4294967296,
    snapshot: () => Object.freeze({ algorithm: 'xorshift32-v1' as const, state }),
  });
}

export function restoreRng(input: unknown): RandomSource {
  return createRng(rngStateSchema.parse(input).state);
}
