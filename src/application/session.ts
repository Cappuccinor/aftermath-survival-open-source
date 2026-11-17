import type { IntentInterpreter } from '../adapters/ai/ports';
import type { GameClient, ObservationSession, ObservationView, VisibleClock, VisiblePlayerStatus, VisibleTarget, VisibleInventory, VisibleSceneContext } from './ports';
import { copyPlayerStatus } from './player-status';
import { copyInventory } from './inventory';
import { copySceneContext } from './scene-context';

export interface SessionOptions {
  readonly initialContactTarget?: VisibleTarget | null;
  readonly history?: import('./ports').HistoryClient;
  /** Trusted application completion hook; runs after a new result is presented. */
  readonly onSettled?: () => Promise<void>;
  readonly initialEntries?: readonly import('./ports').VisibleOutcome[];
  readonly commandIdPrefix?: string;
  readonly canBegin?: () => boolean;
  readonly initialSceneContext?: VisibleSceneContext | null;
  readonly client: GameClient;
  readonly interpreter: IntentInterpreter;
  readonly actorId: string;
  readonly initialClock: VisibleClock;
  readonly initialPlayerStatus?: VisiblePlayerStatus;
  readonly initialLocation?: VisibleTarget | null;
  readonly initialRoutes?: readonly VisibleTarget[];
  readonly initialSearchTargets?: readonly VisibleTarget[];
  readonly initialTargets?: readonly VisibleTarget[];
  readonly initialDoorTargets?: readonly VisibleTarget[];
  readonly initialPickupTargets?: readonly VisibleTarget[];
  readonly initialInventory?: VisibleInventory | null;
  readonly timeoutMs?: number;
}
export function createObservationSession(options: SessionOptions): ObservationSession {
  const timeoutMs = options.timeoutMs ?? 5000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid action timeout');
  let view: ObservationView = Object.freeze({ phase: 'idle', draft: '', clock: Object.freeze({ ...options.initialClock }),
    contactTarget: options.initialContactTarget ? Object.freeze({targetId:options.initialContactTarget.targetId,label:'近处'}) : null,
    sceneContext: copySceneContext(options.initialSceneContext, options.initialLocation ?? null),
    playerStatus: copyPlayerStatus(options.initialPlayerStatus),
    doorTargets: copyTargets(options.initialDoorTargets ?? []),
    pickupTargets: copyTargets(options.initialPickupTargets ?? []), inventory: copyInventory(options.initialInventory),
    currentLocation: options.initialLocation ? Object.freeze({ ...options.initialLocation }) : null, routes: copyTargets(options.initialRoutes ?? []),
    entries: Object.freeze((options.initialEntries ?? []).map(entry => Object.freeze({ summary: entry.summary,
      facts: Object.freeze(entry.facts.map(fact => Object.freeze({ ...fact }))) }))),
    message: options.initialEntries ? '已读取存档，可以继续行动。未手动保存的变化会丢失。' : '尚未行动。可以选择建议，也可以写下自己的行动。', canRetry: false,
    searchTargets: copyTargets(options.initialSearchTargets ?? []), inspectTargets: copyTargets(options.initialTargets ?? []) });
  const listeners = new Set<(view: ObservationView) => void>();
  let counter = 0;
  let lastNarratedRevision = options.initialClock.worldRevision;
  type TargetVerb = 'inspect' | 'move' | 'search' | 'observe_door_gap' | 'pick_up' | 'talk';
  type Proposal = { readonly verb: 'observe' } | { readonly verb: TargetVerb; readonly targetId: string };
  type UnsupportedIntent = { readonly kind: 'unsupported_intent'; readonly verb: 'attack' };
  function proposalTargets(verb: TargetVerb) {
    if(verb==='talk')return view.contactTarget?[view.contactTarget]:[];
    return verb === 'pick_up' ? view.pickupTargets : verb === 'observe_door_gap' ? view.doorTargets : verb === 'inspect' ? view.inspectTargets : verb === 'search' ? view.searchTargets : view.routes;
  }
  function copyTargets(targets: readonly VisibleTarget[]) {
    return Object.freeze(targets.map(target => Object.freeze({ targetId: target.targetId, label: target.label })));
  }
  function validatedProposal(proposal: unknown): Proposal | UnsupportedIntent | undefined {
    try {
      if (typeof proposal !== 'object' || proposal === null || Array.isArray(proposal)
        || Object.getPrototypeOf(proposal) !== Object.prototype) return;
      // Inspect data descriptors, not property values: an untrusted getter is not an intent.
      const fields = Object.getOwnPropertyDescriptors(proposal), keys = Reflect.ownKeys(fields);
      if (keys.length < 1 || keys.length > 2 || keys.some(key => typeof key !== 'string' || !('value' in fields[key]!))) return;
      const verb: unknown = fields.verb?.value;
      if (keys.length === 2 && fields.kind?.value === 'unsupported_intent' && verb === 'attack') {
        return { kind: 'unsupported_intent', verb: 'attack' };
      }
      // Keep executable proposals' exact enumerable field contract and current-target checks.
      if (keys.some(key => !fields[key as string]!.enumerable)) return;
      if (verb === 'observe' && keys.length === 1) return { verb: 'observe' };
      const targetId: unknown = fields.targetId?.value;
      if ((verb === 'inspect' || verb === 'move' || verb === 'search' || verb === 'observe_door_gap' || verb === 'pick_up' || verb === 'talk')
        && keys.length === 2 && typeof targetId === 'string' && proposalTargets(verb).some(target => target.targetId === targetId)) {
        return { verb, targetId };
      }
    } catch { /* Reflection on a malformed provider result can throw; it grants no capability. */ }
  }
  function command(source: 'button' | 'text', utterance: string, proposal: Proposal) {
    return Object.freeze({ commandId: `${options.commandIdPrefix ?? 'cmd-ui'}-${++counter}`, actorId: options.actorId, source, verb: proposal.verb === 'observe_door_gap' ? 'observe' : proposal.verb,
      targetIds: Object.freeze(proposal.verb !== 'observe' ? [proposal.targetId] : []), toolIds: Object.freeze([]),
      arguments: Object.freeze(proposal.verb==='talk'?{topic:'greeting'}:proposal.verb === 'observe_door_gap' ? { through: 'door_gap', careful: true } : {}), utterance,
      expectedWorldRevision: view.clock.worldRevision });
  }
  type Action = { readonly command: ReturnType<typeof command>; readonly submittedDraft: string | null };
  let uncertain: Action | undefined;
  function update(change: Partial<ObservationView>) {
    view = Object.freeze({ ...view, ...change });
    for (const listener of listeners) listener(view);
  }
  async function bounded<T>(operation: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([operation, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Action deadline exceeded')), timeoutMs);
      })]);
    } finally { if (timer !== undefined) clearTimeout(timer); }
  }
  async function execute(action: Action) {
    try {
      const reply = await bounded(options.client.dispatch(action.command));
      if (!reply.ok) {
        uncertain = undefined;
        update({ phase: 'error', canRetry: false, message: '行动未执行，时间与已有叙事保持不变。请修改输入或再次尝试。' });
        return;
      }
      const currentProjection = reply.clock.worldRevision >= view.clock.worldRevision && reply.clock.gameClockMinutes >= view.clock.gameClockMinutes;
      const clock = currentProjection ? Object.freeze({ ...reply.clock }) : view.clock;
      const playerStatus = currentProjection ? copyPlayerStatus(reply.playerStatus) : view.playerStatus;
      const doorTargets = currentProjection ? copyTargets(reply.doorTargets ?? []) : view.doorTargets;
      const pickupTargets = currentProjection ? copyTargets(reply.pickupTargets ?? []) : view.pickupTargets;
      const inventory = currentProjection ? copyInventory(reply.inventory) : view.inventory;
      const inspectTargets = currentProjection ? copyTargets(reply.inspectTargets) : view.inspectTargets;
      const searchTargets = currentProjection ? copyTargets(reply.searchTargets ?? []) : view.searchTargets;
      const routes = currentProjection ? copyTargets(reply.routes ?? []) : view.routes;
      const currentLocation = currentProjection ? (reply.currentLocation ? Object.freeze({ ...reply.currentLocation }) : null) : view.currentLocation;
      const sceneContext = currentProjection ? copySceneContext(reply.sceneContext, currentLocation) : view.sceneContext;
      const contactTarget=currentProjection?(reply.contactTarget&&reply.contactTarget.targetId===currentLocation?.targetId?Object.freeze({targetId:reply.contactTarget.targetId,label:'近处'}):null):(view.contactTarget??null);
      const isNew = reply.committedRevision > lastNarratedRevision;
      const outcome = Object.freeze({ summary: reply.outcome.summary,
        facts: Object.freeze(reply.outcome.facts.map(fact => Object.freeze({ factId: fact.factId, description: fact.description }))) });
      const entries = isNew ? Object.freeze([...view.entries, outcome].slice(-3)) : view.entries;
      if (isNew) lastNarratedRevision = reply.committedRevision;
      const draft = action.submittedDraft !== null && action.submittedDraft === view.draft ? '' : view.draft;
      uncertain = undefined;
      update({ phase: 'success', canRetry: false, clock, playerStatus, doorTargets, pickupTargets, inventory, sceneContext, entries, draft, inspectTargets, searchTargets, routes, currentLocation, contactTarget,
        message: `${isNew ? '本次行动已完成' : '该行动已确认，未重复执行'}，${reply.persistence.ok ? '进度已保存' : '进度尚未保存'}。可以继续输入下一步行动。` });
      if (isNew) await options.onSettled?.();
    } catch {
      uncertain = action;
      update({ phase: 'error', canRetry: true,
        message: '尚未确认行动结果，输入已保留。请先重试确认上次行动，避免重复执行。' });
    }
  }
  async function begin(fromText: boolean, buttonProposal: Proposal = { verb: 'observe' }) {
    if (view.phase === 'pending' || uncertain || options.canBegin?.() === false) return;
    const draft = view.draft;
    update({ phase: 'pending', canRetry: false, message: fromText ? '正在理解这次行动…' : '正在行动，等待结算结果…' });
    let proposal: Proposal | UnsupportedIntent | undefined = validatedProposal(buttonProposal);
    if (fromText) {
      const controller = new AbortController();
      try {
        const parsed = await bounded(options.interpreter.interpret({ utterance: draft,
          ...(view.contactTarget?{contactTarget:view.contactTarget}:{}),
          view: view.entries.at(-1) ?? { summary: '尚未行动', facts: [] }, targets: view.inspectTargets, searchTargets: view.searchTargets, routes: view.routes,
          ...(view.doorTargets.length ? { doorTargets: view.doorTargets } : {}),
          ...(view.pickupTargets.length ? { pickupTargets: view.pickupTargets } : {}) }, { timeoutMs, signal: controller.signal }));
        proposal = validatedProposal(parsed.ok ? parsed.value : null);
        if (!proposal) {
          update({ phase: 'error', message: draft.trim() ? '目前无法执行这句话，本次没有行动。输入已保留，可修改后重试；例如“看看周围”。' : '请先写下你的行动。本次没有行动。' });
          return;
        }
      } catch {
        update({ phase: 'error', message: '暂时无法理解这次行动，本次没有执行。输入已保留，请重试。' });
        return;
      } finally { controller.abort(); }
    }
    if (proposal && 'kind' in proposal) {
      update({ phase: 'error', canRetry: false,
        message: '已识别为攻击意图，但当前尚未实现攻击。本次没有行动。输入已保留，可修改后重试。' });
      return;
    }
    if (!proposal) { update({ phase: 'error', message: '此建议当前不可执行。本次没有行动。' }); return; }
    const target = proposal.verb !== 'observe' ? proposalTargets(proposal.verb).find(item => item.targetId === proposal.targetId) : undefined;
    const utterance = fromText ? draft : proposal.verb==='talk'?'向周围打招呼':target ? `${proposal.verb === 'pick_up' ? '拾取' : proposal.verb === 'observe_door_gap' ? '观察' : proposal.verb === 'move' ? '前往' : proposal.verb === 'search' ? '搜索' : '检查'}${target.label}` : '观察四周';
    await execute({ command: command(fromText ? 'text' : 'button', utterance, proposal), submittedDraft: fromText ? draft : null });
  }
  return Object.freeze({
    greet:()=>begin(false,{verb:'talk',targetId:view.contactTarget?.targetId??''}),
    ...(options.history ? { history: options.history } : {}),
    read: () => view,
    subscribe(listener: (view: ObservationView) => void) { listeners.add(listener); listener(view); return () => { listeners.delete(listener); }; },
    setDraft(text: string) { update({ draft: text }); },
    observeDoorGap: (targetId: string) => begin(false, { verb: 'observe_door_gap', targetId }),
    pickUp: (targetId: string) => begin(false, { verb: 'pick_up', targetId }),
    observe: () => begin(false), search: (targetId: string) => begin(false, {verb:'search',targetId}), move: (targetId: string) => begin(false, { verb: 'move', targetId }), inspect: (targetId: string) => begin(false, { verb: 'inspect', targetId }), submitText: () => begin(true),
    async retry() {
      if (view.phase === 'pending' || !uncertain || options.canBegin?.() === false) return;
      const action = uncertain;
      update({ phase: 'pending', message: '正在确认上次行动，不会重复结算…' });
      await execute(action);
    },
  });
}
