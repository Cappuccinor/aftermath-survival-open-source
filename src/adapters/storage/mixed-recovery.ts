import {SaveFormatError,type SaveMetadata} from './save-format';
import {decodeSaveVersioned} from './save-versions';
import {prepareV1Migration,rawDigest,migrationRecordSchema} from './migration';
import {freezeSnapshot} from '../../core/schema';
import {z} from 'zod';
export class MixedRecoveryError extends Error {constructor(readonly code:string){super(code);}}
// Independent strict kind/prefix; the existing upgrade record retains its old schema.
export const recoveryRecordSchema=migrationRecordSchema.extend({kind:z.literal('previous-v1-to-v2'),
 sourcePreviousToken:z.string().min(1),previousHash:z.string().regex(/^[0-9a-f]{64}$/),
 previousArchiveKey:z.string().regex(/^migration-original:[0-9a-f]{64}$/)});
/** Recognized current damage is established by the strict codec before reading its version. */
export async function prepareMixedRecovery(currentText:string,previousText:string,metadata:SaveMetadata){
 let currentDocument=null,currentIssue:'checksum_mismatch'|'inconsistent_fields'|'invalid_world'|null=null;
 try{currentDocument=await decodeSaveVersioned(currentText);}
 catch(error){
  if(!(error instanceof SaveFormatError)||!['checksum_mismatch','inconsistent_fields','invalid_world'].includes(error.code))throw new MixedRecoveryError('current_recovery_refused');
  currentIssue=error.code as Exclude<typeof currentIssue,null>;
 }
 if(JSON.parse(currentText).schemaVersion!==2)throw new MixedRecoveryError('cross_version_recovery_required');
 const currentHash=await rawDigest(currentText);
 let candidate;
 try{candidate=await prepareV1Migration(previousText,metadata);}catch{throw new MixedRecoveryError('previous_invalid');}
 return freezeSnapshot({currentDocument,currentIssue,previousDocument:candidate.sourceDocument,candidate,currentHash});
}
