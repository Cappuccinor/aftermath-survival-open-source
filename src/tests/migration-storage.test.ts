import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { createIndexedDbStorage } from '../adapters/storage/indexed-db';
import { prepareV1Migration } from '../adapters/storage/migration';
import { encodeSaveVersioned } from '../adapters/storage/save-versions';
import { createContactPrototype } from '../core/contact-prototype';
import type { CommitMigrationRequest } from '../adapters/storage/port';
const text = readFileSync('src/tests/save-fixtures/v1.json', 'utf8');
const metadata = { gameBuild: 'g2-010-test', savedAtUtc: '2026-10-26T00:00:00.000Z' };
function denied() { let opened = 0; const store = createIndexedDbStorage({ factory: { open() { opened++; throw Error('STOP_BEFORE_DB'); } } as unknown as IDBFactory }); return { store, calls: () => opened }; }
async function request(): Promise<CommitMigrationRequest> { const candidate = await prepareV1Migration(text, metadata); return {
  slotId: 'manual-1', expectedToken: 'token', expectedPreviousToken: 'previous', expectedCurrentText: text,
  expectedPreviousText: '\n' + text, candidateText: candidate.text,
}; }
test.each(['slot', 'token', 'previous', 'source', 'candidate', 'not-a-mapping'] as const)('%s invalid migration preflight cannot even open DB', async kind => {
  const d = denied(), q: any = await request();
  if (kind === 'slot') q.slotId = 'manual-4';
  if (kind === 'token') q.expectedToken = '';
  if (kind === 'previous') q.expectedPreviousText = null;
  if (kind === 'source') q.expectedCurrentText = '{bad';
  if (kind === 'candidate') q.candidateText = text;
  if (kind === 'not-a-mapping') q.candidateText = await encodeSaveVersioned(createContactPrototype(), metadata);
  expect((await d.store.commitMigration!(q)).ok).toBe(false); expect(d.calls()).toBe(0);
});
test('valid pure candidate reaches storage boundary but a denied DB is never reported written', async () => {
  const d = denied(); expect(await d.store.commitMigration!(await request())).toEqual({ ok: false, code: 'storage_error' }); expect(d.calls()).toBe(1);
});
test('cancelled candidate remains data, not a write or retry permission', async () => {
  const d = denied(), c = new AbortController(); c.abort();
  expect(await d.store.commitMigration!({ ...await request(), signal: c.signal })).toEqual({ ok: false, code: 'cancelled' }); expect(d.calls()).toBe(0);
});
test.each(['upgrade', 'downgrade'] as const)('ordinary imported %s is refused before DB even with explicit replace data', async direction => {
  const d = denied(), next = (await prepareV1Migration(text, metadata)).text;
  expect(await d.store.replaceImported!(direction === 'upgrade' ? next : text, { slotId: 'manual-1', expectedToken: 'current', expectedPreviousToken: null,
    expectedText: direction === 'upgrade' ? text : next })).toEqual({ ok: false, code: direction === 'upgrade' ? 'migration_required' : 'downgrade_refused' });
  expect(d.calls()).toBe(0);
});
test.each(['upgrade', 'downgrade'] as const)('mixed previous %s cannot use ordinary recovery', async direction => {
  const d = denied(), next = (await prepareV1Migration(text, metadata)).text;
  expect(await d.store.recoverPrevious!({ slotId: 'manual-1', expectedToken: 'current', expectedPreviousToken: 'previous',
    expectedCurrentText: direction === 'upgrade' ? text : next, expectedPreviousText: direction === 'upgrade' ? next : text }))
    .toEqual({ ok: false, code: 'cross_version_recovery_required' }); expect(d.calls()).toBe(0);
});
test('same-version v2 recovery remains eligible for the real storage boundary', async () => {
  const d = denied(), next = (await prepareV1Migration(text, metadata)).text;
  expect(await d.store.recoverPrevious!({ slotId: 'manual-1', expectedToken: 'current', expectedPreviousToken: 'previous',
    expectedCurrentText: next, expectedPreviousText: next })).toEqual({ ok: false, code: 'storage_error' }); expect(d.calls()).toBe(1);
});
