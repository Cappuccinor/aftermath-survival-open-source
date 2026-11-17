import type { ImportFile, ImportView, ManualSlotId } from './ports';
import type { ManualSaveStore, SlotContents, ImportTarget } from '../adapters/storage/port';
import { SaveFormatError } from '../adapters/storage/save-format';
import {decodeSaveVersioned as decodeSave} from '../adapters/storage/save-versions';
import { projectClock } from './clock';
export const MAX_IMPORT_BYTES = 16 * 1024 * 1024;
class ImportFailure extends Error { constructor(readonly code: string) { super(code); } }
function guard(signal: AbortSignal) { if (signal.aborted) throw new ImportFailure('cancelled'); }
/** Blob reads cannot be forcibly stopped: ownership and budget discard late results. */
export async function validateImportFile(file: ImportFile, signal: AbortSignal) {
  guard(signal);
  if (!Number.isSafeInteger(file.size) || file.size < 1) throw new ImportFailure('empty_file');
  if (file.size > MAX_IMPORT_BYTES) throw new ImportFailure('file_too_large');
  let bytes: ArrayBuffer;
  try { bytes = await file.arrayBuffer(); } catch { throw new ImportFailure('file_read_error'); }
  guard(signal);
  if (bytes.byteLength !== file.size) throw new ImportFailure('file_changed');
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { throw new ImportFailure('invalid_utf8'); }
  const document = await decodeSave(text); guard(signal);
  return Object.freeze({ text, document });
}
interface Hooks {
  context(): { key: string; slotId: ManualSlotId };
  lock(controller: AbortController): boolean;
  unlock(controller: AbortController): void;
  remember(slot: ManualSlotId, contents: SlotContents): void;
  invalidate(slot: ManualSlotId): void;
  emit(): void;
}
const label = (slot: ManualSlotId) => `存档槽 ${slot.slice(-1)}`;
function failure(code: string, writing: boolean) {
  if (writing && ['outcome_unknown', 'timeout', 'cancelled', 'unexpected'].includes(code)) return { phase: 'unknown' as const, message: '导入结果尚不能确定，当前游戏未切换。请主动刷新存档列表并检查目标槽；不要盲目重复导入。' };
  const reason = code === 'occupied' ? '目标槽已不再为空，旧确认不能覆盖。请重新选择文件并检查目标。'
    :code==='migration_required'?'不能把 v2 文件普通替换到 v1 槽。可另存空槽；要继续该 v1 原世界，请取消导入并检查升级。'
    :code==='downgrade_refused'?'不能用 v1 文件覆盖 v2。请保留原件，另选空槽。'
    : code === 'conflict' ? '目标存档已改变，未使用旧确认替换。请重新选择文件并检查目标后再次确认。'
    : code === 'unsafe_target' ? '目标存档损坏、缺失或版本不支持，不能替换；请保留或导出原件。'
    : code === 'file_too_large' ? '文件超过 16 MiB，未读取。请选择范围内的有效 v1/v2 文件。'
    : code === 'quota_exceeded' ? '本机存储空间不足，事务未完成。请保留文件并检查存储空间。'
    : ['timeout', 'cancelled'].includes(code) ? '文件读取或校验已超时或取消，可重新选择文件。'
    : ['blocked', 'unavailable', 'storage_error', 'transaction_aborted'].includes(code) ? '暂时无法导入本机存档，请检查浏览器存储权限后主动重试。'
    : '文件读取失败、损坏或版本不支持。需要不超过 16 MiB 的有效 UTF-8 v1/v2 文件；原文件保留。';
  return { phase: 'error' as const, message: `${reason} 当前游戏与输入保留；未确认导入成功。` };
}
/** Trusted orchestration; the view contains only safe metadata, never file contents. */
export function createImportFlow(store: ManualSaveStore, hooks: Hooks, timeoutMs: number) {
  let view: ImportView = { phase: 'idle', slotId: null, message: '选择有效 v1/v2 文件（最多 16 MiB），检查后确认导入空槽或替换健康槽；不会自动切换当前游戏。' };
  let candidate: (Awaited<ReturnType<typeof validateImportFile>> & { target: ImportTarget }) | undefined;
  let context: ReturnType<Hooks['context']> | undefined, controller: AbortController | undefined, serial = 0;
  const preparing = () => view.phase === 'reading' || view.phase === 'confirm';
  function reset() { candidate = undefined; context = undefined; view = { phase: 'idle', slotId: null, message: '可选择有效 v1/v2 文件并检查目标槽；当前游戏未切换。' }; }
  function cancel() {
    if (view.phase === 'writing') { controller?.abort(); return; }
    serial++; controller?.abort(); if (controller) hooks.unlock(controller); controller = undefined; reset(); hooks.emit();
  }
  async function execute(writing: boolean, work: (signal: AbortSignal, check: () => void) => Promise<void>) {
    const own = new AbortController(), ticket = ++serial, captured = hooks.context();
    if (!hooks.lock(own)) return;
    controller = own; view = { ...(writing && view.kind ? { kind: view.kind } : {}), phase: writing ? 'writing' : 'reading', slotId: captured.slotId,
      message: `${writing ? '正在原子导入' : '正在读取并校验文件，目标'}${label(captured.slotId)}…可继续编辑输入。` }; hooks.emit();
    const check = () => { if (own.signal.aborted || serial !== ticket || hooks.context().key !== captured.key) throw new ImportFailure('cancelled'); };
    let timer: ReturnType<typeof setTimeout> | undefined, stop: (() => void) | undefined;
    try {
      await Promise.race([work(own.signal, check), new Promise<never>((_, reject) => {
        stop = () => reject(new ImportFailure('cancelled')); own.signal.addEventListener('abort', stop, { once: true });
        timer = setTimeout(() => { own.abort(); reject(new ImportFailure('timeout')); }, timeoutMs);
      })]);
    } catch (error) {
      if (serial === ticket && hooks.context().key === captured.key) {
        candidate = undefined; context = undefined;
        const code = error instanceof ImportFailure || error instanceof SaveFormatError ? error.code : 'unexpected';
        const failed = failure(code, writing);
        if (failed.phase === 'unknown' || code === 'conflict' || code === 'unsafe_target') hooks.invalidate(captured.slotId);
        view = { ...failed, slotId: captured.slotId };
      }
    } finally {
      if (timer !== undefined) clearTimeout(timer); if (stop) own.signal.removeEventListener('abort', stop);
      hooks.unlock(own); if (controller === own) controller = undefined; hooks.emit();
    }
  }
  return {
    read: () => Object.freeze({ ...view }), preparing,
    pending: () => candidate !== undefined,
    cancel,
    async prepare(file: ImportFile) {
      if (view.phase === 'writing') return;
      if (preparing()) cancel();
      const target = hooks.context();
      await execute(false, async (signal, check) => {
        if (!store.importEmpty) throw new ImportFailure('unavailable');
        const validated = await validateImportFile(file, signal); check();
        let inspected: ImportTarget = { kind: 'empty' };
        if (store.inspectImportTarget) {
          const result = await store.inspectImportTarget(target.slotId, signal); check();
          if (!result.ok) throw new ImportFailure(['invalid_format', 'invalid_world', 'unsupported_version', 'checksum_mismatch', 'inconsistent_fields', 'missing_snapshot'].includes(result.code) ? 'unsafe_target' : result.code);
          inspected = result.value;
        }
        if (inspected.kind === 'replace' && !store.replaceImported) throw new ImportFailure('unavailable');
        if(inspected.kind==='replace'&&inspected.document.schemaVersion!==validated.document.schemaVersion)throw new ImportFailure(validated.document.schemaVersion===2?'migration_required':'downgrade_refused');
        candidate = { ...validated, target: inspected }; context = target;
        if (inspected.kind === 'replace') {
          view = { phase: 'confirm', kind: 'replace', slotId: target.slotId, message: '旧档：保存于 ' + inspected.document.savedAtUtc + ' · ' + projectClock(inspected.document.worldState).label + '。文件：有效 v1/v2，保存于 ' + validated.document.savedAtUtc + ' · ' + projectClock(validated.document.worldState).label + '。确认替换' + label(target.slotId) + '？原当前档保留为上一备份；当前游戏不切换。' };
          return;
        }
        view = { phase: 'confirm', kind: 'empty', slotId: target.slotId, message: `有效 v1/v2 文件：保存于 ${validated.document.savedAtUtc} · ${projectClock(validated.document.worldState).label}。确认导入${label(target.slotId)}？仅允许空槽；当前游戏不会切换。` };
      });
    },
    async confirm() {
      if (!candidate || !context || view.phase !== 'confirm' || hooks.context().key !== context.key) return;
      const chosen = candidate, target = context.slotId; candidate = undefined; context = undefined;
      await execute(true, async (signal, check) => {
        check(); if (!store.importEmpty) throw new ImportFailure('unavailable');
        const checked = chosen.target;
        const result = checked.kind === 'replace'
          ? await store.replaceImported!(chosen.text, { slotId: target, expectedToken: checked.token, expectedPreviousToken: checked.previousToken, expectedText: checked.text, signal })
          : await store.importEmpty(chosen.text, target, signal); check();
        if (!result.ok) throw new ImportFailure(result.code);
        hooks.remember(target, result.value);
        view = { phase: 'imported', slotId: target, message: `已导入到${label(target)}，当前游戏未切换；可主动读取。${checked.kind === 'replace' ? '原当前档已保留为上一备份；可另行检查并确认恢复。' : ''}` };
      });
    },
  };
}
