import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createEngine } from '../core/engine';
import { createContactPrototype } from '../core/contact-prototype';
import { encodeSave, decodeSave } from '../adapters/storage/save-format';
import { encodeSaveVersioned, decodeSaveVersioned } from '../adapters/storage/save-versions';
import { prepareV1Migration } from '../adapters/storage/migration';

const metadata = { gameBuild: 'g2-010', savedAtUtc: '2026-10-26T00:00:00.000Z' };
const raw = readFileSync('src/tests/save-fixtures/v1.json', 'utf8');
function sorted(v: any): any { return Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, x]) => [k, sorted(x)])) : v; }
function sign(value: any) { const { checksums, ...p } = value; return JSON.stringify({ ...p, checksums: { state: createHash('sha256').update(JSON.stringify(sorted(p))).digest('hex') } }); }
function greeted() {
  const e = createEngine(createContactPrototype());
  for (const verb of ['move', 'talk', 'talk']) {
    const w = e.snapshot(); const r = e.dispatch({ commandId: `save-contact-${w.campaign.worldRevision}`, actorId: w.player.playerId,
      source: 'text', verb, targetIds: ['prototype-corridor'], toolIds: [], arguments: verb === 'talk' ? { topic: 'greeting' } : {},
      expectedWorldRevision: w.campaign.worldRevision, utterance: '' });
    expect(r.ok).toBe(true);
  }
  return e.snapshot();
}
test('v1 codec remains version-pinned, never wraps a new world as old format', async () => {
  const world = greeted();
  await expect(encodeSave(world, metadata)).rejects.toMatchObject({ code: 'invalid_world' });
  const fake = JSON.parse(raw); fake.worldState = world; fake.saveId = world.campaign.saveId;
  fake.worldRevision = world.campaign.worldRevision; fake.gameClockMinutes = world.campaign.gameClockMinutes;
  fake.eventJournal = world.eventJournal; fake.rngState = world.rngState;
  await expect(decodeSave(sign(fake))).rejects.toMatchObject({ code: 'invalid_world' });
});
test('v2 roundtrips actual relationship, memory, hidden truth and full journal', async () => {
  const world = greeted(), text = await encodeSaveVersioned(world, metadata), result = await decodeSaveVersioned(text);
  expect(result.schemaVersion).toBe(2); expect(result.worldState).toEqual(world);
  expect(result.worldState.relationships[0]).toMatchObject({ hostility: 40 });
  expect((result.worldState as any).npcMemories).toHaveLength(2);
  expect(result.eventJournal).toEqual(world.eventJournal); expect(result.rngState).toEqual(world.rngState);
  await expect(decodeSave(text)).rejects.toMatchObject({ code: 'unsupported_version' });
});
test('strict dual reader keeps real v1 and does not auto-upgrade it', async () => {
  const result = await decodeSaveVersioned(raw); expect(result).toEqual(await decodeSave(raw));
  expect(result.schemaVersion).toBe(1); expect(result.worldState.stateSchema).toBe('g0-world-v1');
  expect(await encodeSaveVersioned(result.worldState, metadata)).toBe(await encodeSave(result.worldState, metadata));
});
test('pure migration changes only approved mapping, keeps source bytes, IDs, time, RNG and static death', async () => {
  const source = JSON.parse(raw), c = await prepareV1Migration(raw, metadata);
  expect(c.sourceText).toBe(raw); expect(c.sourceHash).toBe(createHash('sha256').update(raw).digest('hex'));
  expect(c.sourceDocument).toEqual(await decodeSave(raw)); expect(c.document).toEqual(await decodeSaveVersioned(c.text));
  expect(c.document.schemaVersion).toBe(2); expect(c.document.gameBuild).toBe(metadata.gameBuild); expect(c.document.savedAtUtc).toBe(metadata.savedAtUtc);
  const { stateSchema, npcMemories, ...world } = c.document.worldState as any;
  expect(stateSchema).toBe('g2-world-v2'); expect(npcMemories).toEqual([]);
  expect({ ...world, stateSchema: 'g0-world-v1' }).toEqual(source.worldState);
  expect(c.document.eventJournal).toEqual(source.eventJournal); expect(c.document.rngState).toEqual(source.rngState);
  expect(c.document.worldState.relationships).toEqual([]);
  expect(readFileSync('src/tests/save-fixtures/v1.json', 'utf8')).toBe(raw);
  expect(Object.isFrozen(c)).toBe(true); expect(Object.isFrozen(c.document.worldState)).toBe(true);
});
test('pure migration deterministic for given metadata and refuses an already new version', async () => {
  const a = await prepareV1Migration(raw, metadata), b = await prepareV1Migration(raw, metadata); expect(a).toEqual(b);
  await expect(prepareV1Migration(a.text, metadata)).rejects.toMatchObject({ code: 'unsupported_version' });
});
test.each(['extra', 'checksum', 'revision', 'rng', 'journal', 'relation', 'memory', 'internal', 'future'] as const)('v2 rejects %s corruption without fallback or dropped fields', async kind => {
  const d = JSON.parse(await encodeSaveVersioned(greeted(), metadata));
  if (kind === 'extra') d.extra = true;
  if (kind === 'checksum') d.checksums.state = '0'.repeat(64);
  if (kind === 'revision') d.worldRevision++;
  if (kind === 'rng') d.rngState.state++;
  if (kind === 'journal') d.eventJournal = [];
  if (kind === 'relation') d.worldState.relationships[0].hostility++;
  if (kind === 'memory') d.worldState.npcMemories = [];
  if (kind === 'internal') d.worldState.stateSchema = 'g0-world-v1';
  if (kind === 'future') d.schemaVersion = 3;
  await expect(decodeSaveVersioned(kind === 'checksum' ? JSON.stringify(d) : sign(d))).rejects.toHaveProperty('code');
});
test.each(['bad json', raw.replace('aftermath-save', 'other-format'), raw.replace('"schemaVersion":1', '"schemaVersion":99')])('migration rejects invalid source without mutating its bytes', async source => {
  const before = source; await expect(prepareV1Migration(source, metadata)).rejects.toHaveProperty('code'); expect(source).toBe(before);
});
