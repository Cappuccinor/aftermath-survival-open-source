import type { ExportSnapshot } from '../adapters/storage/port';

/** Trusted download capability; never handed to UI or AI. Preparation must not start a file. */
export interface PreparedDownload { start(): void; dispose(): void }
export interface DownloadPort {
  prepare(file: { readonly filename: string; readonly text: string }, signal: AbortSignal): Promise<PreparedDownload>;
}
export class DownloadFailure extends Error { constructor(readonly code: 'download_busy') { super(code); } }
export function exportFile(snapshot: ExportSnapshot) {
  return Object.freeze({ text: snapshot.text, filename: `aftermath-${snapshot.slotId}-${snapshot.kind === 'valid' ? `v${snapshot.schemaVersion??1}-r${snapshot.worldRevision}` : 'original'}.json` });
}
export function exportFailure(code: string) {
  const reason = code === 'empty' ? '所选槽没有已保存的当前快照。'
    : code === 'timeout' ? '读取或准备下载超时，请稍后主动重试。'
    : code === 'cancelled' ? '本次导出已取消，请重新发起。'
    : ['missing_snapshot', 'invalid_format'].includes(code) ? '无法定位该槽当前快照，原数据保留。'
    : ['non_text', 'invalid_utf8'].includes(code) ? '原数据不是可无损下载的 UTF-8 文本，已保留原件。'
    : code === 'download_busy' ? '浏览器下载准备繁忙，请等待 30 秒后主动重试。'
    : code === 'download_error' ? '浏览器暂未能发起下载，请检查下载设置后重试。'
    : '暂时无法读取本机存档，请检查浏览器存储权限后重试。';
  return `${reason} 未发起下载；当前世界、输入与存档均未改变。`;
}
