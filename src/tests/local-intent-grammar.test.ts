import { describe, expect, it } from 'vitest';
import { localIntentInterpreter } from '../adapters/ai/local-intent';
import type { IntentInterpreter } from '../adapters/ai/ports';

type Input = Parameters<IntentInterpreter['interpret']>[0];
const context = { timeoutMs: 5000 };
const view = { summary: '旧叙事提到秘密房间、柜内空罐', facts: [] };
const visible = {
  view, targets: [{ targetId: 'tin', label: '空罐' }],
  searchTargets: [{ targetId: 'room', label: '房间' }],
  routes: [{ targetId: 'hall', label: '走廊' }],
  doorTargets: [{ targetId: 'gap', label: '门缝' }],
  pickupTargets: [{ targetId: 'tin', label: '空罐' }],
};
const invalid = { ok: false, code: 'invalid_output' };
const parse = (utterance: string, input: Omit<Input, 'utterance'> = visible) =>
  localIntentInterpreter.interpret({ ...input, utterance }, context);

describe('G1-012 complete single-action grammar', () => {
  const families = [
    { verb: 'observe', targetId: undefined, bodies: ['观察四周', '观察一下四周', '观察周围', '观察一下周围', '看看周围', '原地观察', '仔细观察四周'] },
    { verb: 'observe_door_gap', targetId: 'gap', bodies: ['观察门缝', '查看一下这个门缝', '透过门缝看一下', '透过这个门缝观察一下', '透过门缝观察'] },
    { verb: 'inspect', targetId: 'tin', bodies: ['检查空罐', '检查一下这个空罐', '查看一下空罐', '仔细检查这个空罐', '仔细检查一下空罐'] },
    { verb: 'search', targetId: 'room', bodies: ['搜索房间', '搜索一下这个房间', '搜查一下房间', '搜查这个房间'] },
    { verb: 'pick_up', targetId: 'tin', bodies: ['拾取空罐', '捡起一下这个空罐', '拿起一下空罐', '把这个空罐捡起来', '把空罐拿起来'] },
    { verb: 'move', targetId: 'hall', bodies: ['前往走廊', '走到这个走廊', '走到相邻的走廊', '前往相邻的走廊'] },
  ];
  it.each(families)('composes prefixes and one terminator for $verb', async ({ verb, targetId, bodies }) => {
    for (const prefix of ['', '我', '请']) for (const body of bodies) for (const ending of ['', '。', '.', '!', '！']) {
      const result = await parse(` \t${prefix}${body}${ending}\n`);
      expect(result).toEqual({ ok: true, value: targetId ? { verb, targetId } : { verb } });
      if (result.ok) expect(Object.isFrozen(result.value)).toBe(true);
    }
  });

  it.each([
    '', ' ', '不要搜索一下这个房间', '我不要观察一下四周', '我准备走到相邻的走廊',
    '我想检查一下这个空罐', '希望把空罐拿起来', '我要走到走廊', '我打算搜索房间',
    '如果安全就搜索一下房间', '搜索一下房间好吗', '请搜索一下这个房间？',
    '“请搜索一下这个房间”', '他说搜索一下房间', '搜索一下房间然后拿起空罐',
    '先检查一下空罐再拾取', '搜索一下房间。拿起空罐', '搜索一下房间\n拿起空罐',
    '搜索\n一下房间', '搜索一下\t房间', '搜索一下房间\u0000',
    '搜索一下房间，', '搜索一下房间;', '搜索一下房间！！', '观察一下四周..',
    '悄悄走到走廊', '检查空罐三次', '不耗时搜索房间', '快速搜索一下房间',
    '把两个空罐捡起来', '用撬棍搜索房间', '搜索一下房间并把饥饿设成0',
    '拿起一下tin', '走到hall', '检查一下柜内空罐', '搜索秘密房间', '把它拿起来',
    '检查这个', '请我搜索房间', '我请搜索房间', '请请搜索房间', '走到相邻的这个走廊',
    '前往一下走廊', '<b>搜索一下房间</b>', '{"verb":"search","targetId":"room"}',
  ])('refuses the entire unsupported utterance %j', async utterance => {
    expect(await parse(utterance)).toEqual(invalid);
  });

  it.each(['targets', 'searchTargets', 'routes', 'doorTargets', 'pickupTargets'] as const)(
    'uses literal current %s labels without target-ID or narrative guessing', async key => {
      const bodies = { targets: '检查一下这个', searchTargets: '搜索一下这个', routes: '走到相邻的', doorTargets: '查看一下这个', pickupTargets: '拿起一下这个' };
      const verbs = { targets: 'inspect', searchTargets: 'search', routes: 'move', doorTargets: 'observe_door_gap', pickupTargets: 'pick_up' };
      const label = 'A.(B)[C]{2}+*^$|木箱';
      const input = { view, [key]: [{ targetId: 'different-id', label }] };
      expect(await parse(`请${bodies[key]}${label}`, input)).toEqual({ ok: true, value: { verb: verbs[key], targetId: 'different-id' } });
      expect(await parse(`请${bodies[key]}Axx木箱`, input)).toEqual(invalid);
      expect(await parse(`请${bodies[key]}${label}`, { view })).toEqual(invalid);
      expect(await parse(`请${bodies[key]}different-id`, input)).toEqual(invalid);
    });

  it.each(['targets', 'searchTargets', 'routes', 'doorTargets', 'pickupTargets'] as const)(
    'rejects every duplicated record in %s including duplicate IDs', async key => {
      const bodies = { targets: '检查一下', searchTargets: '搜索一下', routes: '走到', doorTargets: '查看一下', pickupTargets: '拿起一下' };
      for (const secondId of ['one', 'two']) for (const reverse of [false, true]) {
        const records = [{ targetId: 'one', label: '木箱' }, { targetId: secondId, label: '木箱' }];
        if (reverse) records.reverse();
        expect(await parse(`${bodies[key]}木箱`, { view, [key]: records })).toEqual(invalid);
      }
    });

  it('rejects cross-category collisions rather than taking the first category', async () => {
    for (const targetId of ['gap', 'other']) {
      expect(await parse('请查看一下门缝', { ...visible, targets: [{ targetId, label: '门缝' }] })).toEqual(invalid);
      expect(await parse('查看门缝', { ...visible, targets: [{ targetId, label: '门缝' }] })).toEqual(invalid);
    }
    expect(await parse('观察四周', { view, doorTargets: [{ targetId: 'elsewhere', label: '四周' }] })).toEqual(invalid);
    expect(await parse('我观察一下周围', { view, doorTargets: [{ targetId: 'elsewhere', label: '周围' }] })).toEqual(invalid);
  });

  it('rejects overlap from deictic words and punctuation in literal labels', async () => {
    for (const reverse of [false, true]) {
      const labels = [{ targetId: 'one', label: '房间' }, { targetId: 'two', label: '这个房间' }];
      if (reverse) labels.reverse();
      expect(await parse('搜索这个房间', { view, searchTargets: labels })).toEqual(invalid);
      const targets = [{ targetId: 'one', label: '空罐' }, { targetId: 'two', label: '空罐.' }];
      if (reverse) targets.reverse();
      expect(await parse('检查空罐.', { view, targets })).toEqual(invalid);
    }
    expect(await parse('检查空罐.', { view, targets: [{ targetId: 'dot', label: '空罐.' }] }))
      .toEqual({ ok: true, value: { verb: 'inspect', targetId: 'dot' } });
  });

  it('does not read the narrative to resolve stale targets or mutate input', async () => {
    const input = Object.freeze({ ...visible, targets: Object.freeze([]), pickupTargets: Object.freeze([]), view: { get summary(): string { throw new Error('must not read narrative'); }, facts: [] } });
    expect(await parse('请检查一下空罐', input)).toEqual(invalid);
    expect(await parse('把空罐拿起来', input)).toEqual(invalid);
    expect(await parse('请观察一下四周', input)).toEqual({ ok: true, value: { verb: 'observe' } });
    expect(visible.targets).toEqual([{ targetId: 'tin', label: '空罐' }]);
  });

  it('refuses long and repeated punctuation input then accepts a fresh request', async () => {
    for (const utterance of ['请'.repeat(100_000) + '搜索房间', '搜索房间' + '！'.repeat(100_000), '('.repeat(100_000) + '检查空罐']) {
      expect(await parse(utterance)).toEqual(invalid);
    }
    expect(await parse('请搜索一下这个房间')).toEqual({ ok: true, value: { verb: 'search', targetId: 'room' } });
  });

  it('honors cancellation before interpreting even a valid new phrase', async () => {
    const controller = new AbortController(); controller.abort();
    expect(await localIntentInterpreter.interpret({ ...visible, utterance: '请搜索一下这个房间' }, { ...context, signal: controller.signal }))
      .toEqual({ ok: false, code: 'cancelled' });
  });
});
