import type { CallContext, PortResult, VisibleOutcome, VisibleTarget } from '../../application/ports';

export interface IntentInterpreter {
  interpret(input: { readonly utterance: string; readonly view: VisibleOutcome; readonly contactTarget?: VisibleTarget; readonly targets?: readonly VisibleTarget[]; readonly searchTargets?: readonly VisibleTarget[]; readonly routes?: readonly VisibleTarget[]; readonly doorTargets?: readonly VisibleTarget[]; readonly pickupTargets?: readonly VisibleTarget[] }, context: CallContext): Promise<PortResult<unknown>>;
}
export interface Narrator {
  narrate(view: VisibleOutcome, context: CallContext): Promise<PortResult<string>>;
}
export interface DialogueWriter {
  writeDialogue(input: { readonly speakerLabel: string; readonly view: VisibleOutcome }, context: CallContext): Promise<PortResult<string>>;
}
export interface SuggestionGenerator {
  suggest(view: VisibleOutcome, context: CallContext): Promise<PortResult<readonly { readonly label: string; readonly proposal: unknown }[]>>;
}

// Real providers must validate outputs and enforce timeout/cancellation before returning.
const unavailable = async () => ({ ok: false as const, code: 'not_implemented' as const });
export const unavailableAi: IntentInterpreter & Narrator & DialogueWriter & SuggestionGenerator = Object.freeze({
  interpret: unavailable, narrate: unavailable, writeDialogue: unavailable, suggest: unavailable,
});
