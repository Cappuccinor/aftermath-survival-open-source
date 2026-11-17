import { z } from 'zod';
import { createEngine } from '../../core/engine';
import type { WorldState } from '../../core/world';
import { freezeSnapshot, idSchema, integerSchema, clockSchema } from '../../core/schema';

export type SaveFormatCode = 'invalid_format' | 'unsupported_version' | 'checksum_mismatch' | 'inconsistent_fields' | 'invalid_world';
export class SaveFormatError extends Error {
  constructor(readonly code: SaveFormatCode) { super(code); this.name = 'SaveFormatError'; }
}
export interface SaveMetadata { readonly gameBuild: string; readonly savedAtUtc: string }
export interface SaveDocument extends SaveMetadata {
  readonly format: 'aftermath-save'; readonly schemaVersion: 1;
  readonly saveId: string; readonly worldRevision: number; readonly gameClockMinutes: number;
  readonly rngState: WorldState['rngState']; readonly eventJournal: WorldState['eventJournal'];
  readonly worldState: WorldState; readonly checksums: { readonly state: string };
}
const metadataSchema = z.strictObject({ gameBuild: z.string().min(1).max(128), savedAtUtc: z.iso.datetime({ precision: 3 }) });
const envelopeSchema = z.strictObject({
  format: z.literal('aftermath-save'), schemaVersion: z.literal(1), ...metadataSchema.shape,
  saveId: idSchema, worldRevision: integerSchema, gameClockMinutes: clockSchema,
  rngState: z.json(), worldState: z.json(), eventJournal: z.json(),
  checksums: z.strictObject({ state: z.string().regex(/^[0-9a-f]{64}$/) }),
});

/** Deterministic encoding for validated JSON: UTF16 key order; arrays retain order. */
export function canonicalJSON(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJSON((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  throw new SaveFormatError('invalid_format');
}
export async function digest(payload: unknown): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJSON(payload)));
  return Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('');
}
function validatedWorld(input: unknown): WorldState {
  try {
    const world = createEngine(input).snapshot();
    if (world.stateSchema !== 'g0-world-v1') throw Error('Not a v1 world');
    return world;
  }
  catch { throw new SaveFormatError('invalid_world'); }
}
export async function encodeSave(input: unknown, metadata: SaveMetadata): Promise<string> {
  const validMetadata = metadataSchema.safeParse(metadata);
  if (!validMetadata.success) throw new SaveFormatError('invalid_format');
  const worldState = validatedWorld(input);
  const payload = { format: 'aftermath-save' as const, schemaVersion: 1 as const, ...validMetadata.data,
    saveId: worldState.campaign.saveId, worldRevision: worldState.campaign.worldRevision,
    gameClockMinutes: worldState.campaign.gameClockMinutes, rngState: worldState.rngState,
    worldState, eventJournal: worldState.eventJournal };
  return canonicalJSON({ ...payload, checksums: { state: await digest(payload) } });
}
export async function decodeSave(raw: string): Promise<SaveDocument> {
  let input: unknown;
  try { input = JSON.parse(raw); }
  catch { throw new SaveFormatError('invalid_format'); }
  if (input && typeof input === 'object' && 'format' in input && input.format === 'aftermath-save'
    && 'schemaVersion' in input && input.schemaVersion !== 1) throw new SaveFormatError('unsupported_version');
  const parsed = envelopeSchema.safeParse(input);
  if (!parsed.success) throw new SaveFormatError('invalid_format');
  const { checksums, ...payload } = parsed.data;
  if (await digest(payload) !== checksums.state) throw new SaveFormatError('checksum_mismatch');
  const inner = payload.worldState;
  if (!inner || typeof inner !== 'object' || Array.isArray(inner) || !inner.campaign || typeof inner.campaign !== 'object' || Array.isArray(inner.campaign)) {
    throw new SaveFormatError('invalid_world');
  }
  if (inner.campaign.saveId !== payload.saveId || inner.campaign.worldRevision !== payload.worldRevision
    || inner.campaign.gameClockMinutes !== payload.gameClockMinutes
    || canonicalJSON(inner.rngState) !== canonicalJSON(payload.rngState)
    || canonicalJSON(inner.eventJournal) !== canonicalJSON(payload.eventJournal)) throw new SaveFormatError('inconsistent_fields');
  const worldState = validatedWorld(inner);
  return freezeSnapshot({ ...payload, worldState, rngState: worldState.rngState, eventJournal: worldState.eventJournal, checksums });
}
