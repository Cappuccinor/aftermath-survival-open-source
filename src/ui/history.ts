import type { HistoryClient, HistoryPage } from '../application/ports';

/** A session-scoped, readonly disclosure; no world or persistence authority. */
export function createHistoryPanel(document: Document) {
  const element = document.createElement('details'); element.id = 'world-memory'; element.hidden = true;
  const title = document.createElement('summary'); title.textContent = '世界记忆';
  const hint = document.createElement('p');
  hint.textContent = '当前世界已提交行动的可见记录，描述当时的经历。是否已保存请查看存档状态。';
  const range = document.createElement('p'); range.id = 'memory-page'; range.setAttribute('aria-live', 'polite');
  const entries = document.createElement('ol'); entries.id = 'memory-entries';
  const navigation = document.createElement('div'); navigation.className = 'memory-navigation';
  const earlier = document.createElement('button'); earlier.type = 'button'; earlier.id = 'memory-earlier'; earlier.textContent = '更早';
  const newer = document.createElement('button'); newer.type = 'button'; newer.id = 'memory-newer'; newer.textContent = '更新';
  navigation.append(earlier, newer); element.append(title, hint, range, entries, navigation);
  const handlers = new AbortController();
  let client: HistoryClient | undefined;
  let current: HistoryPage | undefined;
  let unsubscribe: (() => void) | undefined;
  let generation = 0;
  let disposed = false;
  function render(page: HistoryPage) {
    current = page;
    range.textContent = page.total === 0 ? '尚无已提交的行动记录。' : `第 ${page.page} / ${page.pages} 页 · 第 ${page.from}–${page.to} 条，共 ${page.total} 条`;
    earlier.disabled = !page.canEarlier; newer.disabled = !page.canNewer;
    entries.start = page.from || 1;
    entries.replaceChildren(...page.entries.map(entry => {
      const row = document.createElement('li');
      const time = document.createElement('span'); time.className = 'memory-time'; time.textContent = entry.timeLabel;
      const summary = document.createElement('p'); summary.textContent = entry.summary;
      row.append(time, summary); return row;
    }));
  }
  for (const [button, direction] of [[earlier, -1], [newer, 1]] as const) {
    button.addEventListener('click', event => {
      if (event.detail <= 1 && current) client?.selectPage(current.page + direction);
    }, { signal: handlers.signal });
    button.addEventListener('keydown', event => {
      if (event.repeat && (event.key === 'Enter' || event.key === ' ')) event.preventDefault();
    }, { signal: handlers.signal });
  }
  function bind(next?: HistoryClient) {
    if (disposed) return;
    const ticket = ++generation;
    unsubscribe?.(); unsubscribe = undefined;
    client = next; current = undefined;
    element.open = false; element.hidden = !next; entries.replaceChildren(); range.textContent = '';
    if (!next) return;
    render(next.read());
    unsubscribe = next.subscribe(page => { if (!disposed && ticket === generation) render(page); });
  }
  function dispose() {
    disposed = true; generation++; unsubscribe?.(); unsubscribe = undefined; client = undefined; current = undefined; handlers.abort();
  }
  return { element, bind, dispose };
}
