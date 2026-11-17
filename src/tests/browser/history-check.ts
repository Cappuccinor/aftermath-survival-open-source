import { decodeSave } from '../../adapters/storage/save-format';
import { projectHistoryPage } from '../../application/history';
import { createHistoryPanel } from '../../ui/history';
import type { HistoryClient, HistoryPage } from '../../application/ports';
export { verifyImportedWorld } from './import-file-check';

export async function historyProof(text: string) {
  const saved = await decodeSave(text);
  const latest = projectHistoryPage(saved.worldState);
  return Array.from({ length: latest.pages }, (_, i) => projectHistoryPage(saved.worldState, i + 1));
}

/** Separate test composition, never imported by the public bootstrap. */
export function panelProof() {
  const check = (value: boolean, message: string) => { if (!value) throw Error(message); };
  const panel = createHistoryPanel(document); document.body.append(panel.element);
  const input = document.createElement('textarea'); document.body.append(input); input.value = '保留草稿'; input.focus();
  const page = (label: string): HistoryPage => ({ page: 1, pages: 2, total: 21, from: 1, to: 20, canEarlier: false, canNewer: true, entries: [{ timeLabel: '生存第1天 08:01', summary: label }] });
  let oldCallback: ((page: HistoryPage) => void) | undefined;
  let nextCallback: ((page: HistoryPage) => void) | undefined;
  let oldUnsubscribed = 0, selected = 0;
  const a: HistoryClient = { read: () => page('A历史'), selectPage: () => { throw Error('Stale client used'); }, subscribe: fn => { oldCallback = fn; fn(page('A历史')); return () => { oldUnsubscribed++; }; } };
  const b: HistoryClient = { read: () => page('B历史'), selectPage: n => { selected = n as number; }, subscribe: fn => { nextCallback = fn; return () => {}; } };
  panel.bind(a); panel.element.open = true; panel.bind(b);
  oldCallback?.(page('A迟到历史'));
  check(oldUnsubscribed === 1 && !panel.element.open && panel.element.textContent!.includes('B历史') && !panel.element.textContent!.includes('A迟到'), 'Session binding leaked');
  const long = '<img src=x onerror=alert(1)>' + '长文本'.repeat(400);
  nextCallback?.(page(long));
  check(document.activeElement === input && input.value === '保留草稿', 'History stole draft/focus');
  check(panel.element.querySelector('img') === null && panel.element.textContent!.includes(long), 'Unsafe/truncated text');
  panel.element.open = true;
  check(document.documentElement.scrollWidth <= innerWidth, 'History overflow');
  (panel.element.querySelector('#memory-newer') as HTMLButtonElement).click(); check(selected === 2, 'Page button not bound to B');
  panel.dispose(); const before = panel.element.textContent;
  nextCallback?.(page('disposed')); oldCallback?.(page('old')); panel.bind(a);
  check(panel.element.textContent === before, 'Disposed callback changed panel');
  panel.element.remove(); input.remove();
  return { staleSubscription: true, newSessionCollapsed: true, safeLongText: true, focusDraftPreserved: true, disposed: true };
}
