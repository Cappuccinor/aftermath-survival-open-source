import type { IntentInterpreter } from './ports';

type TargetVerb = 'observe_door_gap' | 'inspect' | 'search' | 'pick_up' | 'move';
type Candidate = { readonly verb: 'observe' } | { readonly verb: TargetVerb | 'talk'; readonly targetId: string };
const observations = new Set(['观察四周', '观察一下四周', '观察周围', '观察一下周围', '看看周围', '原地观察', '仔细观察四周']);
const attackStatements = new Set(['他', 'NPC'].flatMap(word =>
  ['攻击', '我攻击', '我精准击杀', '我杀了', '我要杀死'].map(prefix => prefix + word)));

function targetMatches(body: string, verb: TargetVerb, label: string): boolean {
  const names = [label, `这个${label}`];
  const afterVerb = (verbs: readonly string[]) => verbs.some(word =>
    names.some(name => body === word + name || body === word + '一下' + name));
  switch (verb) {
    case 'observe_door_gap': return afterVerb(['观察', '查看']) || names.some(name =>
      ['观察', '观察一下', '看一下'].some(ending => body === '透过' + name + ending));
    case 'inspect': return afterVerb(['检查', '查看', '仔细检查']);
    case 'search': return afterVerb(['搜索', '搜查']);
    case 'pick_up': return afterVerb(['拾取', '捡起', '拿起']) || names.some(name =>
      ['捡起来', '拿起来'].some(ending => body === '把' + name + ending));
    case 'move': return ['前往', '走到'].some(word =>
      [...names, `相邻的${label}`].some(name => body === word + name));
  }
}

export const localIntentInterpreter: IntentInterpreter = Object.freeze<IntentInterpreter>({
  async interpret(input, context) {
    if (context.signal?.aborted) return { ok: false, code: 'cancelled' };
    const phrase = input.utterance.trim();
    // Only a complete single sentence is eligible. Never remove unknown clauses or modifiers.
    if (/[\u0000-\u001f?？,，;；"'“”‘’「」『』<>]/.test(phrase) || /[。.!！]{2}$/.test(phrase)) {
      return { ok: false, code: 'invalid_output' };
    }
    // Keep both readings so a literal trailing dot cannot hide another matching label.
    const sentences = [phrase];
    if (/[。.!！]$/.test(phrase)) sentences.push(phrase.slice(0, -1));
    // This is a category only: never resolve the pronoun or read a world target list.
    if (sentences.some(sentence => attackStatements.has(sentence))) {
      return { ok: true, value: Object.freeze({ kind: 'unsupported_intent', verb: 'attack' }) };
    }
    const bodies = sentences.map(sentence => /^[我请]/.test(sentence) ? sentence.slice(1) : sentence);
    const candidates: Candidate[] = [];
    if(input.contactTarget&&bodies.some(body=>['打招呼','向近处打招呼','向周围打招呼','向近处的人打招呼'].includes(body)))candidates.push({verb:'talk',targetId:input.contactTarget.targetId});
    if (bodies.some(body => observations.has(body))) candidates.push({ verb: 'observe' });
    const groups = [
      ['observe_door_gap', input.doorTargets], ['inspect', input.targets],
      ['search', input.searchTargets], ['pick_up', input.pickupTargets], ['move', input.routes],
    ] as const;
    for (const [verb, targets] of groups) for (const target of targets ?? []) {
      // Count records across all categories, including duplicate IDs; never pick by order.
      if (bodies.some(body => targetMatches(body, verb, target.label))) {
        candidates.push({ verb, targetId: target.targetId });
      }
    }
    if (candidates.length !== 1) return { ok: false, code: 'invalid_output' };
    return { ok: true, value: Object.freeze(candidates[0]!) };
  },
});
