import { encodeSave, decodeSave, SaveFormatError } from './save-format';
import type { SaveMetadata, SaveDocument as LegacyDocument } from './save-format';
import { encodeSaveV2, decodeSaveV2 } from './save-v2';
// Storage boundary preserves the existing structurally testable full-world DTO.
// Runtime codecs, not this transport type, prove the envelope/internal binding.
export type SaveDocument = Omit<LegacyDocument, 'schemaVersion'> & { readonly schemaVersion: 1 | 2 };

export async function encodeSaveVersioned(input: unknown, metadata: SaveMetadata): Promise<string> {
  return input && typeof input === 'object' && 'stateSchema' in input && input.stateSchema === 'g2-world-v2'
    ? encodeSaveV2(input, metadata) : encodeSave(input, metadata);
}
export async function decodeSaveVersioned(raw: string): Promise<SaveDocument> {
  let input: unknown;
  try { input = JSON.parse(raw); } catch { throw new SaveFormatError('invalid_format'); }
  if (input && typeof input === 'object' && 'format' in input && input.format === 'aftermath-save'
    && 'schemaVersion' in input && input.schemaVersion === 2) {
    // A relabelled old/future placeholder is not our v2 binding, nor recoverable v2 damage.
    if (!('worldState' in input) || !input.worldState || typeof input.worldState !== 'object'
      || !('stateSchema' in input.worldState) || input.worldState.stateSchema !== 'g2-world-v2') throw new SaveFormatError('unsupported_version');
    return decodeSaveV2(raw);
  }
  return decodeSave(raw);
}
