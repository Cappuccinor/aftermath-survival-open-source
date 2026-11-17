import { expect, test, vi } from 'vitest';
import { copyInventory, projectInventory } from '../application/inventory';
import { action, bothDiscovered, tin, water, corridor } from './transfer-fixtures';
const entries = [{ itemId: tin, label: '空罐', count: 1, weightKg: .05 }, { itemId: water, label: '瓶装水', count: 1, weightKg: .5 }];
test.each([[tin, water], [water, tin]])('inventory follows actual ownership in order %s then %s and away from room', (first, second) => {
  const e = bothDiscovered();
  expect(projectInventory(e.snapshot())).toEqual([]);
  for (const [i, id] of [first, second].entries()) {
    expect(e.dispatch(action('pick_up', i + 2, id, e.snapshot().player.playerId)).ok).toBe(true);
    expect(projectInventory(e.snapshot())).toHaveLength(i + 1);
    expect(projectInventory(e.snapshot())).toEqual(expect.arrayContaining(entries.filter(x => i === 1 || x.itemId === id)));
  }
  expect(e.dispatch(action('move', 4, corridor, e.snapshot().player.playerId)).ok).toBe(true);
  expect(projectInventory(e.snapshot())).toEqual(entries);
});
test('copy allows controlled two entries, freezes fresh copies and supports either presentation order', () => {
  for (const input of [entries, [...entries].reverse(), [entries[1]!]]) {
    const out = copyInventory(input); expect(out).toEqual(input); expect(out).not.toBe(input);
    expect(Object.isFrozen(out)).toBe(true); expect(Object.isFrozen(out![0])).toBe(true); expect(out![0]).not.toBe(input[0]);
  }
});
const malformed: Array<[string, () => unknown]> = [
  ['duplicate IDs', () => [entries[0], entries[0]]], ['third entry', () => [...entries, entries[0]]],
  ['unknown label', () => [{ ...entries[1], label: '安全饮用水' }]], ['wrong weight', () => [{ ...entries[1], weightKg: .05 }]],
  ['extra field', () => [{ ...entries[1], secret: true }]], ['symbol item field', () => [{ ...entries[1], [Symbol()]: true }]],
  ['wrong count', () => [{ ...entries[1], count: 2 }]], ['invalid ID', () => [{ ...entries[1], itemId: '' }]],
  ['sparse array', () => new Array(1)], ['array extra', () => Object.assign([], { secret: true })],
  ['array symbol', () => Object.assign([], { [Symbol()]: true })], ['nonenumerable extra', () => Object.defineProperty([], 'hidden', { value: 1 })],
  ['inherited item fields', () => [Object.create(entries[1]!)]], ['non-array', () => ({ 0: entries[1], length: 1 })],
];
test.each(malformed)('malformed %s is unavailable', (_, make) => expect(copyInventory(make())).toBeNull());
test('array and item accessors are rejected without execution', () => {
  const get = vi.fn(() => entries[1]);
  for (const input of [Object.defineProperty([0], '0', { get }), [Object.defineProperty({ ...entries[1] }, 'label', { get })]]) expect(copyInventory(input)).toBeNull();
  expect(get).not.toHaveBeenCalled();
});
