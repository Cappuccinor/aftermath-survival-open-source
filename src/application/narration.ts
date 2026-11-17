import { unavailableAi } from '../adapters/ai/ports';
import type { Narrator } from '../adapters/ai/ports';
import type { VisibleOutcome } from './ports';

/** Trusted composition options, never a player-controlled provider or UI capability. */
export interface NarrationOptions {
  readonly narrator?: Narrator;
  readonly narrationTimeoutMs?: number;
}

/** Native signal identity with contained cooperative subscriptions; not a sandbox for adapter code. */
function narrationCancellation() {
  const controller = new AbortController(), signal = controller.signal;
  const add = signal.addEventListener.bind(signal), remove = signal.removeEventListener.bind(signal);
  type Subscription = { type: string; listener: EventListenerOrEventListenerObject; capture: boolean; wrapped: EventListener };
  const subscriptions: Subscription[] = [];
  let closed = false, onabort: EventListener | null = null;
  function subscribe(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
    if (!listener || closed) return;
    const capture = typeof options === 'boolean' ? options : options?.capture ?? false;
    let entry = subscriptions.find(s => s.type === type && s.listener === listener && s.capture === capture);
    if (!entry) {
      const wrapped: EventListener = event => {
        try {
          const result = typeof listener === 'function' ? listener.call(signal, event) : listener.handleEvent(event);
          // Native EventTarget reports exceptions to the host; contain both sync and async cleanup faults here.
          void Promise.resolve(result).catch(() => {});
        } catch { /* Cancellation must not undo or interrupt a committed action. */ }
      };
      entry = { type, listener, capture, wrapped }; subscriptions.push(entry);
    }
    add(type, entry.wrapped, options);
  }
  function unsubscribe(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) {
    const capture = typeof options === 'boolean' ? options : options?.capture ?? false;
    const index = subscriptions.findIndex(s => s.type === type && s.listener === listener && s.capture === capture);
    const entry = subscriptions[index];
    if (entry) { remove(type, entry.wrapped, { capture }); subscriptions.splice(index, 1); }
  }
  Object.defineProperties(signal, {
    addEventListener: { value: subscribe }, removeEventListener: { value: unsubscribe },
    onabort: { get: () => onabort, set: (listener: EventListener | null) => {
      unsubscribe('abort', onabort); onabort = typeof listener === 'function' && !closed ? listener : null;
      subscribe('abort', onabort);
    } },
  });
  return { signal, cancel() {
    closed = true;
    try { controller.abort(); }
    finally {
      for (const s of subscriptions) remove(s.type, s.wrapped, { capture: s.capture });
      subscriptions.length = 0; onabort = null;
    }
  } };
}

function acceptedText(result: unknown, summary: string): string | undefined {
  try {
    if (typeof result !== 'object' || result === null || Object.getPrototypeOf(result) !== Object.prototype) return;
    const keys = Reflect.ownKeys(result);
    if (keys.length !== 2 || !keys.includes('ok') || !keys.includes('value')) return;
    const ok = Object.getOwnPropertyDescriptor(result, 'ok');
    const value = Object.getOwnPropertyDescriptor(result, 'value');
    if (!ok || !('value' in ok) || ok.value !== true || !value || !('value' in value)) return;
    const text: unknown = value.value;
    if (typeof text !== 'string' || text.length === 0 || text.length > 2048) return;
    // Complete finite membership: only existing sentences with controlled line breaks.
    if (text === summary || text === summary.replace(/。(?!$)/gu, '。\n')) return text;
  } catch { /* Reflection on a malformed/revoked proxy fails closed. */ }
}

export function createNarrationPresenter(options: NarrationOptions) {
  const narrator = options.narrator ?? unavailableAi;
  const timeoutMs = options.narrationTimeoutMs ?? 250;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 1000) throw new Error('Invalid narration timeout');
  return (safe: VisibleOutcome): Promise<VisibleOutcome> => {
    const input = Object.freeze({ summary: safe.summary,
      facts: Object.freeze(safe.facts.map(fact => Object.freeze({ factId: fact.factId, description: fact.description }))) });
    const cancellation = narrationCancellation();
    const context = Object.freeze({ timeoutMs, signal: cancellation.signal });
    return new Promise(resolve => {
      let settled = false;
      const finish = (outcome: VisibleOutcome) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(outcome);
        cancellation.cancel();
      };
      const timer = setTimeout(() => finish(safe), timeoutMs);
      // Attach both handlers immediately. Late results are consumed without validation or mutation.
      // A same-process provider must cooperate: a synchronous infinite loop cannot be preempted.
      void Promise.resolve().then(() => narrator.narrate(input, context)).then(result => {
        if (settled) return;
        const summary = acceptedText(result, safe.summary);
        finish(summary === undefined ? safe : Object.freeze({ summary, facts: safe.facts }));
      }, () => finish(safe));
    });
  };
}
