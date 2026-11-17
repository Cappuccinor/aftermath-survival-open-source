import { decodeSave, SaveFormatError } from './save-format';
import type { SaveMetadata } from './save-format';
import { encodeSaveV2, decodeSaveV2 } from './save-v2';
import { upgradeContactWorld } from '../../core/contact-prototype';
import { freezeSnapshot } from '../../core/schema';
import { z } from 'zod';

export const archiveKey = (hash: string) => `migration-original:${hash}`;
const hashSchema = z.string().regex(/^[0-9a-f]{64}$/);
export const migrationRecordSchema = z.strictObject({ kind: z.literal('v1-to-v2'), slotId: z.enum(['manual-1', 'manual-2', 'manual-3']),
  sourceToken: z.string().min(1), sourcePreviousToken: z.string().min(1).nullable(),
  sourceHash: hashSchema, sourceArchiveKey: z.string().regex(/^migration-original:[0-9a-f]{64}$/),
  previousHash: hashSchema.nullable(), previousArchiveKey: z.string().regex(/^migration-original:[0-9a-f]{64}$/).nullable(),
  destinationToken: z.string().min(1), migratedAtUtc: z.iso.datetime({ precision: 3 }) });

export async function rawDigest(raw: string): Promise<string> {
  const bytes = new TextEncoder().encode(raw);
  if (new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) !== raw) throw new SaveFormatError('invalid_format');
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
}
/** Pure validated conversion. Contains data only, no storage permission or active session. */
export async function prepareV1Migration(raw: string, metadata: SaveMetadata) {
  const sourceHash = await rawDigest(raw), sourceDocument = await decodeSave(raw);
  const text = await encodeSaveV2(upgradeContactWorld(sourceDocument.worldState), metadata), document = await decodeSaveV2(text);
  return freezeSnapshot({ sourceText: raw, sourceHash, sourceDocument, text, document });
}
export type MigrationCandidate = Awaited<ReturnType<typeof prepareV1Migration>>;
