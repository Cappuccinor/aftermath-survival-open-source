import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { encodeSave, decodeSave, canonicalJSON } from '../adapters/storage/save-format';
import { createEngine } from '../core/engine';
import { readActionReceipts } from '../core/receipts';
import type { ActionReceipt } from '../core/receipts';
import { mutableJson } from './fixtures';

const metadata = { gameBuild: 'g2-001', savedAtUtc: '2026-10-24T00:00:00.000Z' };
function files(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(join(path, e.name)) : e.name.endsWith('.json') ? [join(path, e.name)] : []);
}
const samples = ['snapshots', 'transfer-snapshots', 'hidden-item-snapshots', 'lifecycle-snapshots'].flatMap(p => files(`src/tests/${p}`));
const empty = JSON.parse(readFileSync('src/tests/snapshots/g0-empty.json', 'utf8'));
// Independent implementation in tests, not the production serializer/digest.
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, sorted(v)]));
  return value;
}
function sign(doc: Record<string, unknown>): string {
  const { checksums: _, ...payload } = doc;
  return JSON.stringify({ ...payload, checksums: { state: createHash('sha256').update(JSON.stringify(sorted(payload))).digest('hex') } });
}
function retryCommand(receipt: ActionReceipt) {
  const r = receipt.request;
  const door = 'doorId' in r;
  return { commandId: receipt.commandId, actorId: r.actorId, source: 'button', utterance: '', toolIds: [],
    verb: door ? 'observe' : receipt.rule.startsWith('cabinet-search') ? 'search' : receipt.rule.replace(/-v\d+$/, ''),
    targetIds: [door ? r.doorId : 'itemId' in r ? r.itemId : 'destinationId' in r ? r.destinationId : 'cabinetId' in r ? r.cabinetId : r.locationId],
    arguments: door ? { through: 'door_gap', careful: true } : {}, expectedWorldRevision: r.expectedWorldRevision };
}

describe('G2 formal codec: full truth, compatibility and corrupt input', () => {
  it('loads the first frozen formal v1 fixture without migration or world initialization', async () => {
    const raw = readFileSync('src/tests/save-fixtures/v1.json', 'utf8');
    const doc = await decodeSave(raw);
    expect(doc.worldState).toEqual(JSON.parse(readFileSync('src/tests/lifecycle-snapshots/acted-dead.json', 'utf8')));
    expect(readFileSync('src/tests/save-fixtures/v1.json', 'utf8')).toBe(raw);
  });
  it('uses deterministic UTF8 JSON and a standard SHA256 over the entire payload', async () => {
    expect(canonicalJSON({ z: '水', a: [{ b: 2, a: 1 }, true, null] })).toBe('{"a":[{"a":1,"b":2},true,null],"z":"水"}');
    const raw = await encodeSave(empty, metadata), doc = JSON.parse(raw);
    expect(doc).toMatchObject({ format: 'aftermath-save', schemaVersion: 1, ...metadata, saveId: 'save-1', worldRevision: 0, gameClockMinutes: 0 });
    expect(JSON.parse(sign(doc)).checksums).toEqual(doc.checksums);
    expect(raw).toBe(await encodeSave(sorted(empty), metadata));
    expect(doc.worldState.campaign.schemaVersion).toBeNull();
  });
  it.each(samples)('roundtrips full %s, retries original IDs and continues the same RNG branch', async path => {
    const bytes = readFileSync(path, 'utf8'), original = JSON.parse(bytes), before = mutableJson(original);
    const decoded = await decodeSave(await encodeSave(original, metadata));
    expect(decoded.worldState).toEqual(original);
    expect(original).toEqual(before);
    const restored = createEngine(decoded.worldState), uninterrupted = createEngine(original);
    for (const receipt of readActionReceipts(decoded.worldState)) {
      expect(restored.dispatch(retryCommand(receipt))).toMatchObject({ ok: true, replayed: true });
    }
    expect(restored.snapshot()).toEqual(original);
    const command = { commandId: 'cmd-g2-continuation', actorId: original.player.playerId, source: 'text', verb: 'observe',
      targetIds: [], toolIds: [], arguments: {}, utterance: '观察周围', expectedWorldRevision: original.campaign.worldRevision };
    expect(restored.dispatch(command)).toEqual(uninterrupted.dispatch(command));
    expect(restored.snapshot().campaign.gameClockMinutes).toBe(original.campaign.gameClockMinutes + 1);
    expect(readFileSync(path, 'utf8')).toBe(bytes);
  });
  it('keeps hidden NPC ownership and static death, without rewriting either world on save/load', async () => {
    const original = JSON.parse(readFileSync('src/tests/lifecycle-snapshots/acted-dead.json', 'utf8'));
    const doc = await decodeSave(await encodeSave(original, metadata));
    expect(doc.worldState.npcs[0]).toMatchObject({ life: { status: 'dead' } });
    expect(Object.values(doc.worldState.items).filter(i => i.position.kind === 'npc')).toHaveLength(1);
    expect(doc.worldState).toEqual(original);
    expect(Object.isFrozen(doc.worldState.player)).toBe(true);
  });
  it.each(['schemaVersion', 'format', 'gameBuild', 'savedAtUtc', 'unexpected'])('rejects invalid envelope field %s before trusting its contents', async field => {
    const d = JSON.parse(await encodeSave(empty, metadata));
    if (field === 'schemaVersion') d[field] = 2;
    else if (field === 'unexpected') d[field] = true;
    else d[field] = '';
    const raw = sign(d);
    await expect(decodeSave(raw)).rejects.toMatchObject({ code: field === 'schemaVersion' ? 'unsupported_version' : 'invalid_format' });
    expect(raw).toBe(sign(d));
  });
  it.each(['saveId', 'worldRevision', 'gameClockMinutes', 'rngState', 'eventJournal'])('rejects a valid checksum with conflicting %s', async field => {
    const d = JSON.parse(await encodeSave(empty, metadata));
    if (field === 'saveId') d[field] = 'save-other';
    else if (field === 'rngState') d[field].state = 2;
    else if (field === 'eventJournal') d[field] = [{ seq: 1 }];
    else d[field] = 1;
    await expect(decodeSave(sign(d))).rejects.toMatchObject({ code: 'inconsistent_fields' });
  });
  it('rejects invalid Core facts even after a correct checksum, and never mutates the input', async () => {
    const d = JSON.parse(await encodeSave(empty, metadata)); d.worldState.player.stats.hp = 101;
    const raw = sign(d);
    await expect(decodeSave(raw)).rejects.toMatchObject({ code: 'invalid_world' });
    const before = mutableJson(d.worldState);
    await expect(encodeSave(d.worldState, metadata)).rejects.toMatchObject({ code: 'invalid_world' });
    expect(d.worldState).toEqual(before);
  });
  it('rejects a corrupted checksum and truncated JSON', async () => {
    const raw = await encodeSave(empty, metadata), d = JSON.parse(raw); d.gameBuild = 'changed';
    await expect(decodeSave(JSON.stringify(d))).rejects.toMatchObject({ code: 'checksum_mismatch' });
    await expect(decodeSave(raw.slice(0, -5))).rejects.toMatchObject({ code: 'invalid_format' });
  });
});
