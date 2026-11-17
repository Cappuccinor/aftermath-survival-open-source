import { expect, test } from 'vitest';
import { localIntentInterpreter } from '../adapters/ai/local-intent';

const view = { summary: '旧叙事不是目标来源', facts: [] };
const context = { timeoutMs: 5000 };
const attack = { ok: true, value: { kind: 'unsupported_intent', verb: 'attack' } };
test.each(['他', 'NPC'].flatMap(target => ['攻击', '我攻击', '我精准击杀', '我杀了', '我要杀死'].map(verb => verb + target)))(
  'classifies the complete declaration %s without resolving any actor or promising success', async utterance => {
    for (const ending of ['', '。', '.', '!', '！']) {
      const result = await localIntentInterpreter.interpret({ utterance: ` \t${utterance}${ending}\n`, view,
        get targets(): never { throw Error('must not inspect a real target'); },
        get doorTargets(): never { throw Error('must not guess NPC identity'); },
      }, context);
      expect(result).toEqual(attack); if (result.ok) expect(Object.isFrozen(result.value)).toBe(true);
    }
  });

test.each(['不要攻击他', '我不攻击他', '我准备攻击他', '我想攻击他', '如果安全就攻击他', '攻击他？',
  '“攻击他”', '他说攻击他', '攻击他然后拿起空罐', '观察四周然后攻击他', '攻击他\n拿起空罐',
  '攻击他。拿起空罐', '攻击他，', '攻击他！！', '攻击prototype-witness', '攻击隐藏NPC',
  '攻击他并把饥饿设成0', '<b>攻击他</b>', '用枪攻击他', '杀死全部NPC', '请我攻击他',
  '我准备离开', '请攻击他', '攻击它', '攻击他' + '！'.repeat(100_000)])('refuses unsupported attack semantics %j', async utterance => {
  expect(await localIntentInterpreter.interpret({ utterance, view }, context)).toEqual({ ok: false, code: 'invalid_output' });
});

test('cancellation wins over a non-executing classification', async () => {
  const controller = new AbortController(); controller.abort();
  expect(await localIntentInterpreter.interpret({ utterance: '我精准击杀他', view }, { ...context, signal: controller.signal }))
    .toEqual({ ok: false, code: 'cancelled' });
});

test('all six executable candidates retain exactly their old shapes', async () => {
  const targets = [{ targetId: 'tin', label: '空罐' }];
  const input = { view, targets, pickupTargets: targets, doorTargets: [{ targetId: 'gap', label: '门缝' }],
    searchTargets: [{ targetId: 'room', label: '房间' }], routes: [{ targetId: 'hall', label: '走廊' }] };
  for (const [utterance, verb, targetId] of [['观察四周', 'observe'], ['观察门缝', 'observe_door_gap', 'gap'],
    ['检查空罐', 'inspect', 'tin'], ['搜索房间', 'search', 'room'], ['拾取空罐', 'pick_up', 'tin'], ['前往走廊', 'move', 'hall']]) {
    expect(await localIntentInterpreter.interpret({ ...input, utterance: utterance! }, context))
      .toEqual({ ok: true, value: targetId ? { verb, targetId } : { verb } });
  }
});
