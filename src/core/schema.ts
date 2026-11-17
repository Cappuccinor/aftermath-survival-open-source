import { z } from 'zod';

export const idSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*$/)
  .refine(id => !['__proto__', 'constructor', 'prototype'].includes(id), 'Reserved ID');
export const integerSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const seedSchema = z.number().int().min(1).max(0xffffffff);
export const MAX_CLOCK_MINUTES = Number.MAX_SAFE_INTEGER - 480;
export const clockSchema = integerSchema.max(MAX_CLOCK_MINUTES);
export const jsonRecordSchema = z.record(z.string(), z.json());

export type DeepReadonly<T> = T extends readonly (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

/** Only used after schema parsing; the input is an owned, acyclic JSON value. */
export function freezeSnapshot<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeSnapshot(child);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}
