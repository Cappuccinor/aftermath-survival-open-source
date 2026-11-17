import { expect, test } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { createEngine } from '../core/engine';
import { upgradeContactWorld } from '../core/contact-prototype';
import { readActionReceipts } from '../core/receipts';
import type { ActionReceipt } from '../core/receipts';

// Existing historical files only; formal v1 is not relabelled as an invented schema0.
const folders = ['snapshots', 'transfer-snapshots', 'hidden-item-snapshots', 'lifecycle-snapshots', 'save-fixtures'];
const samples = folders.flatMap(folder => readdirSync(new URL(`./${folder}/`, import.meta.url), { recursive: true })
  .filter(name => String(name).endsWith('.json')).map(name => `${folder}/${name}`));
function request(r: ActionReceipt) {
  const q = r.request, door = r.rule === 'door-observe-v1' || r.rule === 'door-observe-v2';
  const target = 'itemId' in q ? q.itemId : 'cabinetId' in q ? q.cabinetId : 'doorId' in q ? q.doorId : 'destinationId' in q ? q.destinationId : q.locationId;
  return { commandId: r.commandId, actorId: q.actorId, source: 'button',
    verb: door ? 'observe' : r.rule.startsWith('cabinet-search') ? 'search' : r.rule.split('-v')[0],
    targetIds: [target], toolIds: [], arguments: door ? { through: 'door_gap', careful: true } : {},
    utterance: '', expectedWorldRevision: q.expectedWorldRevision };
}
test('retains the exact18 historical sample responsibilities', () => expect(samples).toHaveLength(18));
test.each(samples)('%s preserves every old field, replays every old ID and leaves next actual door RNG unchanged', file => {
  const raw = JSON.parse(readFileSync(new URL(`./${file}`, import.meta.url), 'utf8'));
  const world = raw.format === 'aftermath-save' ? raw.worldState : raw;
  const old = createEngine(world), next = createEngine(upgradeContactWorld(world));
  const { stateSchema, npcMemories, ...rest } = next.snapshot() as any;
  expect(stateSchema).toBe('g2-world-v2'); expect(npcMemories).toEqual([]);
  expect({ ...rest, stateSchema: 'g0-world-v1' }).toEqual(old.snapshot());
  for (const receipt of readActionReceipts(old.snapshot())) {
    const before = next.snapshot(), result = next.dispatch(request(receipt));
    expect(result).toMatchObject({ ok: true, replayed: true, receipt }); expect(next.snapshot()).toBe(before);
  }
  const door = old.snapshot().eventJournal.find(e => e.type === 'DoorGapInitialized');
  if (!door) return;
  const q = door.payload;
  function both(verb: string, target: string) {
    const w = old.snapshot(), c = { commandId: `compat-${w.campaign.worldRevision}`, actorId: w.player.playerId, source: 'button', verb,
      targetIds: [target], toolIds: [], arguments: verb === 'observe' ? { through: 'door_gap', careful: true } : {}, utterance: '', expectedWorldRevision: w.campaign.worldRevision };
    const a = old.dispatch(c), b = next.dispatch(c); expect(a.ok).toBe(true); expect(b.ok).toBe(true);
    if (a.ok && b.ok) expect(b.receipt).toEqual(a.receipt);
    expect(next.snapshot().rngState).toEqual(old.snapshot().rngState);
  }
  if (old.snapshot().player.locationId !== q.roomId) both('move', String(q.roomId));
  both('observe', String(q.doorId));
});
