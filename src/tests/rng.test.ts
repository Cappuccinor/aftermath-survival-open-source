import { describe, expect, it } from 'vitest';
import { createRng, restoreRng } from '../core/rng';

describe('G0-RNG: versioned deterministic random source', () => {
  it('pins the xorshift32-v1 sequence independently of implementation', () => {
    const rng = createRng(1);
    expect(rng.snapshot()).toEqual({ algorithm: 'xorshift32-v1', state: 1 });
    expect([rng.nextUint32(), rng.nextUint32(), rng.nextUint32()])
      .toEqual([270369, 67634689, 2647435461]);
  });
  it('restores the next draw without advancing or aliasing the saved state', () => {
    const rng = createRng(1);
    rng.nextUint32();
    const checkpoint = rng.snapshot();
    const restored = restoreRng(checkpoint);
    expect(restored.nextUint32()).toBe(67634689);
    expect(rng.nextUint32()).toBe(67634689);
    expect(checkpoint.state).toBe(270369);
    expect(Object.isFrozen(checkpoint)).toBe(true);
  });
  it('uses a half-open [0, 1) float range and independent instances', () => {
    const first = createRng(1);
    const second = createRng(1);
    expect(first.nextFloat()).toBe(270369 / 4294967296);
    expect(second.nextUint32()).toBe(270369);
    const edge = createRng(4294967295);
    for (let i = 0; i < 1000; i++) {
      const draw = edge.nextFloat();
      expect(draw).toBeGreaterThanOrEqual(0);
      expect(draw).toBeLessThan(1);
    }
  });
  it.each([0, -1, 0.5, 4294967296, NaN, Infinity])('rejects invalid seed %s', seed => {
    expect(() => createRng(seed)).toThrow();
  });
  it.each([
    { algorithm: 'other', state: 1 },
    { algorithm: 'xorshift32-v1', state: 0 },
    { algorithm: 'xorshift32-v1', state: 1, ignored: true },
  ])('rejects incompatible or corrupt checkpoints %#', state => {
    expect(() => restoreRng(state)).toThrow();
  });
});
