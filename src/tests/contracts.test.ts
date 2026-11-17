import { describe, expect, it } from 'vitest';
import { parseCommand } from '../core/commands';
import { parseEventJournal } from '../core/events';
import { createWorldState } from '../core/world';
import { unavailableStorage } from '../adapters/storage/port';
import { unavailableAi } from '../adapters/ai/ports';
import { initialInput, mutableJson } from './fixtures';

describe('G0-CONTRACT: shape validation and honest unavailable adapters', () => {
  const command = { commandId: 'cmd-1', actorId: 'player-1', source: 'text', verb: 'custom_action',
    targetIds: [], toolIds: [], arguments: { careful: true }, utterance: '把湿毛巾塞进门缝', expectedWorldRevision: 0 };
  it.each(['button', 'text', 'voice', 'scheduler'])('accepts %s through the same open envelope', source => {
    expect(parseCommand({ ...command, source })).toEqual({ ...command, source });
  });
  it.each([
    { source: 'admin' }, { verb: '' }, { expectedWorldRevision: -1 },
    { expectedWorldRevision: 0.2 }, { commandId: '' }, { targetIds: [1] },
    { arguments: { forged: NaN } }, { worldState: { hp: 999 } },
  ])('rejects malformed envelope %#', change => {
    expect(() => parseCommand({ ...command, ...change })).toThrow();
  });
  it('only parses intent; does not promise execution or mutate the world', () => {
    const world = createWorldState(initialInput);
    const before = mutableJson(world);
    const parsed = parseCommand({ ...command, utterance: '我准备离开', arguments: { nested: { value: 1 } } });
    expect(parsed.utterance).toBe('我准备离开');
    expect(Object.isFrozen(parsed.arguments.nested)).toBe(true);
    expect(world).toEqual(before);
  });
  it('validates journal uniqueness, ordering and monotonic time', () => {
    const event = { eventId: 'evt-1', seq: 1, worldTimeMinutes: 0, type: 'FixtureRecorded',
      actorId: 'player-1', targetIds: [], payload: {}, visibility: 'private' };
    expect(parseEventJournal([event])).toEqual([event]);
    for (const journal of [
      [{ ...event, seq: 2 }], [event, { ...event, seq: 2 }],
      [{ ...event, worldTimeMinutes: 2 }, { ...event, eventId: 'evt-2', seq: 2, worldTimeMinutes: 1 }],
      [{ ...event, payload: { hp: Infinity } }],
    ]) expect(() => parseEventJournal(journal)).toThrow();
  });
  it('never claims a save or load succeeded and leaves the entire snapshot intact', async () => {
    const worldState = createWorldState(initialInput);
    const before = mutableJson(worldState);
    expect(await unavailableStorage.save({ worldState })).toEqual({ ok: false, code: 'not_implemented' });
    expect(await unavailableStorage.load('save-1')).toEqual({ ok: false, code: 'not_implemented' });
    expect(worldState).toEqual(before);
  });
  it('all four AI roles report unavailable using visible data only', async () => {
    const view = { summary: '尚未开始游戏', facts: [] };
    const context = { timeoutMs: 1000 };
    expect(await unavailableAi.interpret({ utterance: '自由行动', view }, context)).toEqual({ ok: false, code: 'not_implemented' });
    expect(await unavailableAi.narrate(view, context)).toEqual({ ok: false, code: 'not_implemented' });
    expect(await unavailableAi.writeDialogue({ speakerLabel: '未知人物', view }, context)).toEqual({ ok: false, code: 'not_implemented' });
    expect(await unavailableAi.suggest(view, context)).toEqual({ ok: false, code: 'not_implemented' });
  });
});
