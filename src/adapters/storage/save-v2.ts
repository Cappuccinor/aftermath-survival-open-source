import { z } from 'zod';
import { createEngine } from '../../core/engine';
import { freezeSnapshot, idSchema, integerSchema, clockSchema } from '../../core/schema';
import type { WorldState } from '../../core/world';
import { canonicalJSON, digest, SaveFormatError } from './save-format';
import type { SaveMetadata, SaveDocument as LegacyDocument } from './save-format';

export type SaveDocumentV2 = Omit<LegacyDocument, 'schemaVersion' | 'worldState'> & {
  readonly schemaVersion: 2; readonly worldState: Extract<WorldState, { stateSchema: 'g2-world-v2' }>;
};
const metadataSchema = z.strictObject({ gameBuild: z.string().min(1).max(128), savedAtUtc: z.iso.datetime({ precision: 3 }) });
const envelopeSchema = z.strictObject({ format: z.literal('aftermath-save'), schemaVersion: z.literal(2), ...metadataSchema.shape,
  saveId: idSchema, worldRevision: integerSchema, gameClockMinutes: clockSchema,
  rngState: z.json(), worldState: z.json(), eventJournal: z.json(),
  checksums: z.strictObject({ state: z.string().regex(/^[0-9a-f]{64}$/) }) });
function validatedWorld(input: unknown): SaveDocumentV2['worldState'] {
  try {
    const world = createEngine(input).snapshot();
    if (world.stateSchema !== 'g2-world-v2') throw Error('Not a v2 world');
    return world;
  } catch { throw new SaveFormatError('invalid_world'); }
}
export async function encodeSaveV2(input: unknown, metadata: SaveMetadata): Promise<string> {
  const parsed = metadataSchema.safeParse(metadata);
  if (!parsed.success) throw new SaveFormatError('invalid_format');
  const worldState = validatedWorld(input);
  const payload = { format: 'aftermath-save', schemaVersion: 2, ...parsed.data,
    saveId: worldState.campaign.saveId, worldRevision: worldState.campaign.worldRevision,
    gameClockMinutes: worldState.campaign.gameClockMinutes, rngState: worldState.rngState,
    worldState, eventJournal: worldState.eventJournal };
  return canonicalJSON({ ...payload, checksums: { state: await digest(payload) } });
}
export async function decodeSaveV2(raw: string): Promise<SaveDocumentV2> {
  let input: unknown;
  try { input = JSON.parse(raw); } catch { throw new SaveFormatError('invalid_format'); }
  const parsed = envelopeSchema.safeParse(input);
  if (!parsed.success) throw new SaveFormatError('invalid_format');
  const { checksums, ...payload } = parsed.data;
  if (await digest(payload) !== checksums.state) throw new SaveFormatError('checksum_mismatch');
  const worldState = validatedWorld(payload.worldState);
  if (payload.saveId !== worldState.campaign.saveId || payload.worldRevision !== worldState.campaign.worldRevision
    || payload.gameClockMinutes !== worldState.campaign.gameClockMinutes
    || canonicalJSON(payload.rngState) !== canonicalJSON(worldState.rngState)
    || canonicalJSON(payload.eventJournal) !== canonicalJSON(worldState.eventJournal)) throw new SaveFormatError('inconsistent_fields');
  return freezeSnapshot({ ...payload, worldState, rngState: worldState.rngState, eventJournal: worldState.eventJournal, checksums });
}
