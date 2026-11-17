import type { WorldState } from '../../core/world';
import type { PortResult, ManualSlotId } from '../../application/ports';

/** Internal full snapshot. Includes clock, RNG and journal; not aftermath-save v1. */
export interface WorldSnapshot { readonly worldState: WorldState }
export interface StoragePort {
  save(snapshot: WorldSnapshot): Promise<PortResult<{ readonly saveId: string; readonly worldRevision: number }>>;
  load(saveId: string): Promise<PortResult<WorldSnapshot>>;
}

export const unavailableStorage: StoragePort = Object.freeze({
  save: async (_snapshot: WorldSnapshot) => ({ ok: false as const, code: 'not_implemented' as const }),
  load: async (_saveId: string) => ({ ok: false as const, code: 'not_implemented' as const }),
});

/** Trusted application-only persistence capability; never import into presentation. */
export type SaveResult<T> = { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: string };
export interface SlotContents {
  readonly token: string | null;
  readonly document: import('./save-versions').SaveDocument | null;
  readonly previous: import('./save-versions').SaveDocument | null;
  readonly backupWarning?: 'invalid_backup';
}
export type ImportTarget = { readonly kind: 'empty' } | {
  readonly kind: 'replace'; readonly token: string; readonly previousToken: string | null;
  readonly text: string; readonly document: import('./save-versions').SaveDocument;
};
export interface ReplaceImportRequest {
  readonly slotId: ManualSlotId; readonly expectedToken: string; readonly expectedPreviousToken: string | null;
  readonly expectedText: string; readonly signal?: AbortSignal;
}
export interface ManualSaveStore {
  inspectConvertedPrevious?(slotId: ManualSlotId, signal?: AbortSignal): Promise<SaveResult<MixedRecoveryTarget>>;
  restoreConvertedPrevious?(request: CommitMixedRecoveryRequest): Promise<SaveResult<SlotContents>>;
  inspectMigration?(slotId: ManualSlotId, signal?: AbortSignal): Promise<SaveResult<MigrationTarget>>;
  commitMigration?(request: CommitMigrationRequest): Promise<SaveResult<SlotContents>>;
  listMigrationOriginals?(slotId: ManualSlotId, signal?: AbortSignal): Promise<SaveResult<readonly MigrationOriginal[]>>;
  exportMigrationOriginal?(slotId: ManualSlotId, key: string, signal?: AbortSignal): Promise<SaveResult<ExportSnapshot>>;
  /** Read validated current facts without creating a missing database; grants no binding. */
  readExisting?(slotId: ManualSlotId, signal?: AbortSignal): Promise<SaveResult<SlotContents>>;
  inspectPrevious?(slotId: ManualSlotId, signal?: AbortSignal): Promise<SaveResult<RecoveryTarget>>;
  recoverPrevious?(request: RecoverPreviousRequest): Promise<SaveResult<SlotContents>>;
  inspectImportTarget?(slotId: ManualSlotId, signal?: AbortSignal): Promise<SaveResult<ImportTarget>>;
  replaceImported?(text: string, request: ReplaceImportRequest): Promise<SaveResult<SlotContents>>;
  /** Validated original text; only a genuinely absent head may be created. */
  importEmpty?(text: string, slotId: ManualSlotId, signal?: AbortSignal): Promise<SaveResult<SlotContents>>;
  /** Optional for older/unavailable adapters. Raw content stays inside trusted composition. */
  exportCurrent?(slotId: ManualSlotId, signal?: AbortSignal): Promise<SaveResult<ExportSnapshot>>;
  read(slotId: ManualSlotId, signal?: AbortSignal): Promise<SaveResult<SlotContents>>;
  write(world: WorldState, request: { readonly slotId: ManualSlotId; readonly expectedToken: string | null; readonly allowReplaceWorld: boolean; readonly signal?: AbortSignal }): Promise<SaveResult<SlotContents>>;
}
export interface RecoveryTarget {
  readonly token: string; readonly previousToken: string;
  readonly currentText: string; readonly previousText: string;
  readonly currentDocument: import('./save-versions').SaveDocument | null;
  readonly currentIssue: 'checksum_mismatch' | 'inconsistent_fields' | 'invalid_world' | null;
  readonly previousDocument: import('./save-versions').SaveDocument;
}
export interface RecoverPreviousRequest {
  readonly slotId: ManualSlotId; readonly expectedToken: string; readonly expectedPreviousToken: string;
  readonly expectedCurrentText: string; readonly expectedPreviousText: string; readonly signal?: AbortSignal;
}
export interface ExportSnapshot {
  readonly schemaVersion?: 1 | 2;
  readonly slotId: ManualSlotId;
  readonly token: string;
  readonly text: string;
  readonly kind: 'valid' | 'original';
  readonly worldRevision?: number;
}
export interface MigrationTarget {
  readonly slotId: ManualSlotId; readonly token: string; readonly previousToken: string | null;
  readonly currentText: string; readonly previousText: string | null;
  readonly candidate: import('./migration').MigrationCandidate;
}
export interface CommitMigrationRequest {
  readonly slotId: ManualSlotId; readonly expectedToken: string; readonly expectedPreviousToken: string | null;
  readonly expectedCurrentText: string; readonly expectedPreviousText: string | null;
  readonly candidateText: string; readonly signal?: AbortSignal;
}
export interface MigrationOriginal {
  readonly key: string; readonly source: 'current' | 'previous' | 'archive';
  readonly schemaVersion: 1 | 2 | null; readonly worldRevision: number | null;
  readonly changedArchive: boolean;
}
export interface MixedRecoveryTarget extends RecoveryTarget {
  readonly slotId: ManualSlotId;
  readonly candidate: import('./migration').MigrationCandidate;
  readonly currentHash: string;
}
export interface CommitMixedRecoveryRequest extends RecoverPreviousRequest {
  readonly candidateText: string;
}
