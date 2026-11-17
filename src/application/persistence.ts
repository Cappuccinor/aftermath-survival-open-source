import { createRecoveryFlow } from './save-recovery';
import {createMigrationFlow} from './save-migration';
import {projectContactTarget} from './contact';
import { createHistoryController } from './history';
import { createImportFlow } from './save-import';
import type { ManualSaveStore, SlotContents, SaveResult } from '../adapters/storage/port';
import type { WorldState } from '../core/world';
import { createEngine } from '../core/engine';
import { readActionReceipts } from '../core/receipts';
import { readCharacterProfile } from '../core/character';
import { visibleSearchTargets } from '../core/search';
import { projectLocation, visibleRoutes } from '../core/movement';
import { visibleInspectionTargets } from '../core/inspection';
import { visibleDoorTargets } from '../core/door-observation';
import { visiblePickupTargets } from '../core/pickup';
import { createGame } from './game';
import { createObservationSession } from './session';
import { projectClock } from './clock';
import { projectPlayerStatus } from './player-status';
import { projectInventory } from './inventory';
import { projectSceneContext } from './scene-context';
import { projectReceiptOutcome } from './receipt-outcome';
import { localIntentInterpreter } from '../adapters/ai/local-intent';
import type { ManualPersistenceClient, PersistenceView, StartedGame, ManualSlotId, ManualSlotSummary } from './ports';
import type { NarrationOptions } from './narration';
import { exportFile, exportFailure, DownloadFailure } from './save-export';
import type { DownloadPort, PreparedDownload } from './save-export';

interface ActiveGame { world: WorldState; started: StartedGame; history: ReturnType<typeof createHistoryController>; bindings: Map<ManualSlotId, { token: string | null; revision: number; checksum: string | undefined }>; lastSlot?: ManualSlotId }
const slotIds: readonly ManualSlotId[] = Object.freeze(['manual-1', 'manual-2', 'manual-3']);
const slotLabel = (id: ManualSlotId) => `存档槽 ${id.slice(-1)}`;
interface Options extends NarrationOptions { readonly timeoutMs?: number; readonly download?: DownloadPort }
class PersistenceFailure extends Error { constructor(readonly code: string) { super(code); } }
function unwrap<T>(result: SaveResult<T>): T { if (!result.ok) throw new PersistenceFailure(result.code); return result.value; }

/** Owns trusted world/storage capabilities. Only client and StartedGame cross into UI. */
export function createPersistenceController(store: ManualSaveStore, options: Options = {}) {
  const timeoutMs = options.timeoutMs ?? 5000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw Error('Invalid persistence timeout');
  let active: ActiveGame | undefined, generation = 0, stopSession: (() => void) | undefined;
  let phase: PersistenceView['phase'] = 'idle', message = '未保存的变化会丢失。';
  let exportState: PersistenceView['export'] = { phase: 'idle', message: '导出所选槽上次保存的进度，不包含尚未保存变化。', slotId: null };
  let selectedSlot: ManualSlotId = 'manual-1';
  const summaries = new Map<ManualSlotId, SaveResult<SlotContents>>();
  let confirmation: { kind: 'save' | 'load'; slotId: ManualSlotId; slot: SlotContents; generation: number; worldId?: string; revision?: number } | undefined;
  let operation: AbortController | undefined;
  let automatic: { mode: 'off' | 'on' | 'paused'; slotId: ManualSlotId | null; lastAttempt: number; message: string } = off();
  let autoWriting = false;
  function off(message = '自动保存已关闭。先手动保存当前进度或主动读档，再明确开启。') {
    return { mode: 'off' as const, slotId: null, lastAttempt: -1, message };
  }
  const listeners = new Set<(view: PersistenceView) => void>();
  const busy = () => operation !== undefined || confirmation !== undefined || importFlow.pending() || recoveryFlow.pending() || migrationFlow.pending();
  const actionBusy = () => active?.started.session.read().phase === 'pending' || active?.started.session.read().canRetry === true;
  const importFlow = createImportFlow(store, {
    context: () => ({ slotId: selectedSlot, key: JSON.stringify([generation, selectedSlot, active?.world.campaign.saveId, active?.world.campaign.worldRevision]) }),
    lock(controller) { if (busy() || actionBusy()) return false; operation = controller; return true; },
    unlock(controller) { if (operation === controller) operation = undefined; },
    remember(id, contents) {
      remember(id, contents);
      if (phase === 'saved' && !savedTo(selectedSlot)) {
        phase = 'idle'; message = '槽中当前存档已被导入文件替换。当前游戏未切换，也未因此保存；请主动读取，旧保存绑定不能覆盖新档。';
      }
    },
    invalidate(id) {
      summaries.set(id, { ok: false, code: 'import_unverified' });
      if (id === selectedSlot) { phase = 'idle'; message = `${slotLabel(id)}的保存状态待核实。当前游戏未切换；请主动刷新列表或读取检查，不要盲目重复导入。`; }
    }, emit,
  }, timeoutMs);
  const migrationFlow=createMigrationFlow(store,{
    context:()=>({slotId:selectedSlot,key:JSON.stringify([generation,selectedSlot,active?.world.campaign.saveId,active?.world.campaign.worldRevision])}),
    lock(controller){if(busy()||actionBusy())return false;operation=controller;return true;},
    unlock(controller){if(operation===controller)operation=undefined;},
    observed(id,contents){remember(id,contents);if(id===selectedSlot){settle();if(!savedTo(id))message='目标槽已检查或升级；当前游戏未切换，也未因此保存。请主动读取，旧保存绑定不能覆盖新档。';}},
    invalidate(id){summaries.set(id,{ok:false,code:'import_unverified'});if(id===selectedSlot){phase='idle';message=`${slotLabel(id)}保存状态待核实。请主动刷新列表或读取检查，不要盲目重复升级。`;}},emit,
  },timeoutMs,options.download);
  const recoveryFlow = createRecoveryFlow(store, {
    context: () => ({ slotId: selectedSlot, key: JSON.stringify([generation, selectedSlot, active?.world.campaign.saveId, active?.world.campaign.worldRevision]) }),
    lock(controller) { if (busy() || actionBusy()) return false; operation = controller; return true; },
    unlock(controller) { if (operation === controller) operation = undefined; },
    observed(id, contents) {
      const wasUnverified = unverified(id);
      remember(id, contents);
      if (phase === 'saved' && !savedTo(selectedSlot)) { phase = 'idle'; message = '检查发现目标当前版本已变化；当前游戏未切换，也未重新绑定。请主动读取或检查存档。'; }
      if (wasUnverified && id === selectedSlot) settle();
    },
    remember(id, contents) {
      migrationFlow.invalidateOriginals(id);
      remember(id, contents);
      if (phase === 'saved' && !savedTo(selectedSlot)) { phase = 'idle'; message = '槽中当前版本已恢复为上一备份。当前游戏未切换，也未因此保存；请主动读取，旧保存绑定不能覆盖恢复后的存档。'; }
    },
    invalidate(id) {
      migrationFlow.invalidateOriginals(id);
      summaries.set(id, { ok: false, code: 'import_unverified' });
      if (id === selectedSlot) { phase = 'idle'; message = `${slotLabel(id)}的保存状态待核实。当前游戏未切换；请主动刷新或读取检查，不要盲目重复恢复。`; }
    }, emit,
  }, timeoutMs);
  function savedTo(id: ManualSlotId): boolean {
    const binding = active?.bindings.get(id), summary = summaries.get(id);
    return !!binding && binding.revision === active!.world.campaign.worldRevision
      && (!summary || (summary.ok && summary.value.token === binding.token
        && !!binding.checksum && summary.value.document?.checksums.state === binding.checksum));
  }
  function unverified(id: ManualSlotId) { const result = summaries.get(id); return result?.ok === false && result.code === 'import_unverified'; }
  function describe(id: ManualSlotId): ManualSlotSummary {
    const result = summaries.get(id), label = slotLabel(id);
    if (!result) return Object.freeze({ id, label, status: 'unchecked', description: `${label} · 尚未检查。` });
    if (unverified(id)) return Object.freeze({ id, label, status: 'unchecked', description: `${label} · 保存状态待核实；请主动刷新列表或读取检查。` });
    if (!result.ok) return Object.freeze({ id, label, status: 'error', description: `${label} · 暂不可读取或版本不支持；原始存档保留。` });
    const slot = result.value;
    return Object.freeze({ id, label, status: slot.document ? 'saved' : 'empty',
      description: slot.document ? `${label} · 保存于 ${slot.document.savedAtUtc} · ${projectClock(slot.document.worldState).label}${slot.backupWarning ? ' 上一备份损坏；原始数据保留，当前档有效。' : ''}` : `${label} · 本机存档槽为空。` });
  }
  function read(): PersistenceView {
    const available = !busy() && !actionBusy(), selected = describe(selectedSlot);
    return Object.freeze({ phase, message, selectedSlot,
      migration:migrationFlow.read(),originals:migrationFlow.originals(),
      canCheckMigration:!!store.inspectMigration&&!!store.commitMigration&&(available||migrationFlow.preparing()),
      canConfirmMigration:migrationFlow.read().phase==='confirm',
      canCancelMigration:migrationFlow.preparing()||migrationFlow.read().phase==='writing',
      canListOriginals:available&&!!store.listMigrationOriginals,
      canExportOriginal:available&&!!store.exportMigrationOriginal&&!!options.download&&migrationFlow.originals().entries.length>0,
      recovery: recoveryFlow.read(), canCheckPrevious: !!store.inspectPrevious && !!store.recoverPrevious && (available || recoveryFlow.preparing()),
      canConfirmRecovery: recoveryFlow.read().phase === 'confirm', canCancelRecovery: recoveryFlow.preparing(),
      import: importFlow.read(), canImport: !!store.importEmpty && (available || importFlow.preparing()),
      canConfirmImport: importFlow.read().phase === 'confirm', canCancelImport: importFlow.preparing(),
      slots: Object.freeze(slotIds.map(describe)),
      export: Object.freeze({ ...exportState }), canExport: available && !!store.exportCurrent && !!options.download,
      autosave: Object.freeze({ mode: autoWriting ? 'saving' : automatic.mode, slotId: automatic.slotId, message: automatic.message }),
      canEnableAutosave: available && !!active && automatic.mode !== 'on',
      canDisableAutosave: available && automatic.mode !== 'off',
      slotDescription: selected.description, savedToSelected: savedTo(selectedSlot),
      currentDescription: !active ? '尚未进入世界；选槽后可主动读取。'
        : `${active.lastSlot ? `当前世界最近读取或保存于${slotLabel(active.lastSlot)}。` : '当前世界尚未保存。'}${unverified(selectedSlot) ? `当前进度是否仍保存于${slotLabel(selectedSlot)}尚待核实。` : savedTo(selectedSlot) ? `当前进度已保存到${slotLabel(selectedSlot)}。` : `当前进度未保存到${slotLabel(selectedSlot)}。`}`,
      busy: busy(), canSave: !!active && available, canLoad: available && selected.status !== 'empty',
      canSelect: available || importFlow.preparing() || recoveryFlow.preparing() || migrationFlow.preparing(), canRefresh: available, confirmation: confirmation?.kind ?? null,
      confirmationLabel: confirmation ? slotLabel(confirmation.slotId) : null });
  }
  function emit() { const state = read(); for (const listener of listeners) listener(state); }
  function remember(id: ManualSlotId, slot: SlotContents) { summaries.set(id, { ok: true, value: slot }); }
  function settle() {
    phase = savedTo(selectedSlot) ? 'saved' : 'idle';
    message = unverified(selectedSlot) ? `${slotLabel(selectedSlot)}的保存状态待核实；请主动刷新列表或读取检查。` : savedTo(selectedSlot) ? `当前进度已保存到${slotLabel(selectedSlot)}。`
      : `当前进度未保存到${slotLabel(selectedSlot)}。${automatic.mode === 'on' ? `自动保存固定到${slotLabel(automatic.slotId!)}；切换手动目标不会改变自动目标。` : '未保存的变化会丢失，请确认保存成功后再退出。'}`;
  }
  function withdrawStaleSaved() {
    if (phase === 'saved' && !savedTo(selectedSlot)) {
      phase = 'idle'; message = automatic.mode === 'on' ? `有未保存的变化；本次行动呈现后将自动保存到${slotLabel(automatic.slotId!)}，请等待保存完成再退出。` : '有未保存的变化；请确认保存成功后再退出。';
    }
  }
  function prepare(input: unknown, restoring: boolean): ActiveGame {
    const world = createEngine(input).snapshot();
    const entry = {} as ActiveGame;
    entry.world = world; entry.bindings = new Map(); entry.history = createHistoryController(world);
    const session = createObservationSession({
      client: createGame(world, { ...options, onCommitted: state => {
        const advanced = state.campaign.worldRevision !== entry.world.campaign.worldRevision;
        entry.world = state;
        if (active === entry && advanced) {
          migrationFlow.invalidateOriginals();
          // Publish truthful persistence feedback before exposing the newly committed history.
          // Autosave still runs only at the existing onSettled boundary; replays do not notify here.
          withdrawStaleSaved();
          if (automatic.mode === 'on') automatic.message = `有未保存的变化；本次行动呈现后将自动保存到${slotLabel(automatic.slotId!)}，请等待保存完成再退出。`;
          emit();
        }
        entry.history.update(state);
      } }), interpreter: localIntentInterpreter,
      history: entry.history.client,
      actorId: world.player.playerId, commandIdPrefix: `cmd-session-${crypto.randomUUID()}`,
      canBegin: () => active === entry && !busy(),
      onSettled: () => autoSave(entry),
      initialClock: projectClock(world), initialPlayerStatus: projectPlayerStatus(world), initialInventory: projectInventory(world),
      initialSceneContext: projectSceneContext(world), initialDoorTargets: visibleDoorTargets(world),
      initialContactTarget: projectContactTarget(world),
      initialPickupTargets: visiblePickupTargets(world), initialTargets: visibleInspectionTargets(world),
      initialSearchTargets: visibleSearchTargets(world), initialLocation: projectLocation(world), initialRoutes: visibleRoutes(world),
      ...(restoring ? { initialEntries: readActionReceipts(world).slice(-3).map(receipt => projectReceiptOutcome(world, receipt)) } : {}),
    });
    entry.started = Object.freeze({ session, character: readCharacterProfile(world) });
    return entry;
  }
  function install(entry: ActiveGame) {
    migrationFlow.cancel();
    importFlow.cancel(); recoveryFlow.cancel(); stopSession?.(); active?.history.dispose(); active = entry; generation++; automatic = off();
    exportState = { phase: 'idle', message: '导出所选槽上次保存的进度，不包含尚未保存变化。', slotId: null };
    settle();
    stopSession = entry.started.session.subscribe(() => {
      if (active !== entry) return;
      withdrawStaleSaved();
      emit();
    });
    return entry.started;
  }
  function start(world: WorldState): StartedGame {
    if(migrationFlow.preparing())migrationFlow.cancel();
    if (recoveryFlow.preparing()) recoveryFlow.cancel();
    if (busy() || actionBusy()) throw Error('Persistence/action in progress');
    return install(prepare(world, false));
  }
  function report(error: unknown) {
    const code = error instanceof PersistenceFailure ? error.code : 'invalid_world';
    const reason = code === 'conflict' || code === 'stale_revision' ? '存档已被其他操作更新或版本较新。请主动读取该槽最新存档才能继续；刷新列表不会解除冲突。读取前会确认是否丢弃未保存变化和输入。'
      :code==='migration_required'?'目标是 v1，不能用 v2 普通覆盖。请检查并确认升级，之后另行读取；当前新游戏可另存空槽。'
      :code==='downgrade_refused'?'不能用 v1 覆盖 v2。请读取目标 v2 或另存空槽；原件可单独下载。'
      : code === 'timeout' ? '存储操作超时，请重试检查本机存档。'
      : code === 'quota_exceeded' ? '本机存储空间不足。'
      : code === 'empty' ? '本机还没有存档。'
      : ['invalid_world', 'invalid_format', 'unsupported_version', 'inconsistent_fields', 'checksum_mismatch'].includes(code)
        ? '存档损坏或版本不受支持，原文件未被覆盖。' : '暂时无法访问或写入本机存档，请重试。';
    phase = 'error'; message = `${reason} 当前世界与输入保留；未确认保存成功。`;
  }
  async function run<T>(kind: 'saving' | 'loading', work: (signal: AbortSignal, check: () => void) => Promise<T>, auto = false): Promise<T | null> {
    if (busy() || actionBusy()) return null;
    const owner = generation, target = selectedSlot, worldId = active?.world.campaign.saveId,
      revision = active?.world.campaign.worldRevision, controller = new AbortController(); operation = controller; phase = kind;
    autoWriting = auto;
    message = auto ? `正在自动保存到${slotLabel(automatic.slotId!)}…可继续编辑输入，完成前请勿关闭页面。`
      : kind === 'saving' ? '正在保存完整世界…可继续编辑输入。' : '正在检查本机存档…可继续编辑输入。';
    if (auto) automatic.message = message;
    emit();
    const check = () => { if (controller.signal.aborted || owner !== generation || target !== selectedSlot
      || worldId !== active?.world.campaign.saveId || revision !== active?.world.campaign.worldRevision) throw new PersistenceFailure('cancelled'); };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([work(controller.signal, check), new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new PersistenceFailure('timeout')); }, timeoutMs);
      })]);
    } catch (error) {
      if (owner === generation) {
        report(error);
        if (auto) { automatic.mode = 'paused'; automatic.message = `自动保存到${slotLabel(automatic.slotId!)}已暂停。${message} 排除原因后请手动保存，再重新开启自动保存。`; message = automatic.message; }
      }
      return null;
    }
    finally { if (timer !== undefined) clearTimeout(timer); if (operation === controller) { operation = undefined; autoWriting = false; } emit(); }
  }
  async function write(slotId: ManualSlotId, slot: SlotContents, signal: AbortSignal, check: () => void, allowed: boolean, auto = false) {
    const entry = active!; const state = entry.world;
    const result = unwrap(await store.write(state, { slotId, expectedToken: slot.token, allowReplaceWorld: allowed, signal })); check();
    remember(slotId, result); entry.bindings.set(slotId, { token: result.token, revision: state.campaign.worldRevision, checksum: result.document?.checksums.state }); entry.lastSlot = slotId; phase = 'saved';
    migrationFlow.invalidateOriginals(slotId);
    if (auto) {
      message = `完整世界已自动保存到${slotLabel(slotId)}。`; automatic.message = `${message} 后续行动将继续自动保存到该槽。`;
    } else {
      message = `完整世界已手动保存到${slotLabel(slotId)}。`;
      if (automatic.slotId && automatic.slotId !== slotId) { automatic = off('已手动保存到另一槽，旧自动保存已关闭。新目标需主动开启。'); message += automatic.message; }
      else message += automatic.mode === 'on' ? '该槽自动保存仍开启。' : '后续变化需手动保存，或明确开启自动保存。';
    }
  }
  async function autoSave(entry: ActiveGame) {
    if (entry !== active || automatic.mode !== 'on' || !automatic.slotId || busy() || actionBusy()) return;
    const revision = entry.world.campaign.worldRevision, slotId = automatic.slotId, binding = entry.bindings.get(slotId);
    if (revision <= automatic.lastAttempt) return;
    automatic.lastAttempt = revision;
    await run('saving', async (signal, check) => {
      if (!binding) throw new PersistenceFailure('conflict');
      // The token was explicitly bound on load/save; never upgrade it from fresh metadata.
      await write(slotId, { token: binding.token, document: null, previous: null }, signal, check, false, true);
    }, true);
  }
  function restore(slotId: ManualSlotId, slot: SlotContents, check: () => void): StartedGame {
    if (!slot.document) throw new PersistenceFailure('empty');
    const candidate = prepare(slot.document.worldState, true); check();
    candidate.bindings.set(slotId, { token: slot.token, revision: candidate.world.campaign.worldRevision, checksum: slot.document.checksums.state }); candidate.lastSlot = slotId;
    return install(candidate);
  }
  const client: ManualPersistenceClient = Object.freeze({
    checkMigration:()=>migrationFlow.inspect(),confirmMigration:()=>migrationFlow.confirm(),cancelMigration:()=>migrationFlow.cancel(),
    listOriginals:()=>migrationFlow.list(),exportOriginal:(id:string)=>migrationFlow.export(id),
    checkPrevious: () => recoveryFlow.inspect(), confirmRecovery: () => recoveryFlow.confirm(), cancelRecovery: () => recoveryFlow.cancel(),
    prepareImport: (file: import('./ports').ImportFile) => importFlow.prepare(file),
    confirmImport: () => importFlow.confirm(),
    cancelImport: () => importFlow.cancel(),
    async exportSave() {
      if (busy() || actionBusy()) return;
      const controller = new AbortController(), owner = generation, target = selectedSlot,
        worldId = active?.world.campaign.saveId, revision = active?.world.campaign.worldRevision;
      operation = controller;
      exportState = { phase: 'reading', slotId: target, message: `正在读取${slotLabel(target)}已保存的快照并准备下载…可继续编辑输入。` }; emit();
      const check = () => { if (controller.signal.aborted || operation !== controller || generation !== owner || selectedSlot !== target
        || worldId !== active?.world.campaign.saveId || revision !== active?.world.campaign.worldRevision) throw new PersistenceFailure('cancelled'); };
      let timer: ReturnType<typeof setTimeout> | undefined;
      const work = async () => {
        if (!store.exportCurrent || !options.download) throw new PersistenceFailure('unavailable');
        const snapshot = unwrap(await store.exportCurrent(target, controller.signal)); check();
        let prepared: PreparedDownload | undefined;
        try {
          try { prepared = await options.download.prepare(exportFile(snapshot), controller.signal); }
          catch (error) { throw new PersistenceFailure(error instanceof DownloadFailure ? error.code : 'download_error'); }
          check();
          try { prepared.start(); } catch { throw new PersistenceFailure('download_error'); }
          exportState = { phase: 'initiated', slotId: target, message: `${slotLabel(target)}${snapshot.kind === 'valid' ? `读取时版本 ${snapshot.worldRevision}` : '原件备份，当前版本无法载入'}：已发起下载，请在浏览器确认文件已保存。不包含尚未保存变化。` };
        } finally { prepared?.dispose(); }
      };
      try { await Promise.race([work(), new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new PersistenceFailure('timeout')); }, timeoutMs); })]); }
      catch (error) { if (generation === owner && operation === controller) exportState = { phase: 'error', slotId: target, message: exportFailure(error instanceof PersistenceFailure ? error.code : 'storage_error') }; }
      finally { if (timer !== undefined) clearTimeout(timer); if (operation === controller) operation = undefined; emit(); }
    },
    async enableAutosave() {
      if (busy() || actionBusy() || automatic.mode === 'on') return;
      const binding = active?.bindings.get(selectedSlot);
      if (!binding || binding.revision !== active!.world.campaign.worldRevision) {
        phase = 'error'; message = '请先手动保存当前进度到所选槽，再开启自动保存。'; emit(); return;
      }
      await run('loading', async (signal, check) => {
        const slotId = selectedSlot, result = await store.read(slotId, signal); check(); summaries.set(slotId, result);
        const slot = unwrap(result);
        if (!slot.document || slot.token !== binding.token) throw new PersistenceFailure('conflict');
        automatic = { mode: 'on', slotId, lastAttempt: active!.world.campaign.worldRevision, message: `自动保存已开启，固定到${slotLabel(slotId)}。每次行动呈现后保存；切换手动目标不会改变此槽。` };
        settle(); message = automatic.message;
      });
    },
    disableAutosave() {
      if (busy() || actionBusy()) return;
      automatic = off(); settle(); message = automatic.message; emit();
    },
    select(slotId: ManualSlotId) {
      if (importFlow.preparing()) importFlow.cancel();
      if (recoveryFlow.preparing()) recoveryFlow.cancel();
      if(migrationFlow.preparing())migrationFlow.cancel();
      if (busy() || actionBusy()) return;
      if (!slotIds.includes(slotId)) { report(new PersistenceFailure('invalid_slot')); emit(); return; }
      migrationFlow.cancel();selectedSlot = slotId; settle(); emit();
    },
    read,
    subscribe(listener: (view: PersistenceView) => void) { listeners.add(listener); listener(read()); return () => { listeners.delete(listener); }; },
    async refresh() {
      await run('loading', async (signal, check) => {
        const results = await Promise.all(slotIds.map(async id => {
          try { return await store.read(id, signal); } catch { return { ok: false as const, code: 'storage_error' }; }
        })); check();
        slotIds.forEach((id, i) => summaries.set(id, results[i]!)); settle(); message = `存档列表已刷新。${message}`;
      });
    },
    async save() {
      if (!active) return;
      await run('saving', async (signal, check) => {
        const slotId = selectedSlot, result = await store.read(slotId, signal); check(); summaries.set(slotId, result); const slot = unwrap(result);
        const binding = active!.bindings.get(slotId);
        if (binding && binding.token !== slot.token) throw new PersistenceFailure('conflict');
        if (slot.document && !binding) {
          confirmation = { kind: 'save', slotId, slot, generation, worldId: active!.world.campaign.saveId, revision: active!.world.campaign.worldRevision }; phase = 'confirm';
          message = `确认用当前世界覆盖${slotLabel(slotId)}中的已有存档？取消会保留原档和当前世界。`; return;
        }
        await write(slotId, slot, signal, check, false);
      });
    },
    async load() {
      return run('loading', async (signal, check) => {
        const slotId = selectedSlot, result = await store.read(slotId, signal); check(); summaries.set(slotId, result); const slot = unwrap(result);
        if (!slot.document) throw new PersistenceFailure('empty');
        if (active && (!slotIds.some(savedTo) || active.started.session.read().draft !== '')) {
          confirmation = { kind: 'load', slotId, slot, generation, worldId: active.world.campaign.saveId, revision: active.world.campaign.worldRevision }; phase = 'confirm';
          message = `读取${slotLabel(slotId)}会丢弃当前未保存的变化和输入。确认读取已检查的存档？取消保留当前世界。`; return null;
        }
        return restore(slotId, slot, check);
      });
    },
    async confirm() {
      if (!confirmation || operation || actionBusy()) return null;
      const pending = confirmation; confirmation = undefined;
      if (pending.generation !== generation || pending.slotId !== selectedSlot || pending.worldId !== active?.world.campaign.saveId
        || pending.revision !== active?.world.campaign.worldRevision) return null;
      return run(pending.kind === 'save' ? 'saving' : 'loading', async (signal, check) => {
        if (pending.kind === 'save') { await write(pending.slotId, pending.slot, signal, check, true); return null; }
        return restore(pending.slotId, pending.slot, check);
      });
    },
    cancel() {
      if (!confirmation || operation) return;
      confirmation = undefined; settle();
      message = '已取消。当前世界、输入和原存档保持不变。'; emit();
    },
  });
  return Object.freeze({ client, start });
}
