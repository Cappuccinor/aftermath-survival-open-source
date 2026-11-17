import { readActionReceipts } from '../core/receipts';
import type { ActionReceipt } from '../core/receipts';
import { getWorldTime } from '../core/world';
import type { WorldState } from '../core/world';
import type { HistoryClient, HistoryEntry, HistoryPage } from './ports';
import { projectReceiptOutcome } from './receipt-outcome';

const pageSize = 20;
const empty: HistoryPage = Object.freeze({ page: 0, pages: 0, total: 0, from: 0, to: 0,
  canEarlier: false, canNewer: false, entries: Object.freeze([]) });

function entry(world: WorldState, receipt: ActionReceipt): HistoryEntry {
  const time = getWorldTime(receipt.observedAt);
  // Legacy capability limits are not historical world facts. All other templates
  // use receipt evidence and fixed labels, never today's inventory or secrets.
  const summary = receipt.rule === 'cabinet-search-v1'
    ? receipt.discoveredItemId ? '你花了一分钟搜索柜子，发现瓶装水。水仍在柜中。' : '你花了一分钟搜索柜子，没有新发现。水仍在柜中。'
    : projectReceiptOutcome(world, receipt).summary;
  return Object.freeze({ timeLabel: `生存第 ${time.worldDay} 天 · ${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')} · 灾变第 ${time.apocalypseDay} 天`,
    summary: `当时：${summary}` });
}
function validPage(page: unknown, pages: number): page is number {
  return typeof page === 'number' && Number.isSafeInteger(page) && page >= 1 && page <= pages;
}
function project(world: WorldState, receipts: readonly ActionReceipt[], requested?: number): HistoryPage {
  const total = receipts.length;
  if (!total) return empty;
  const pages = Math.ceil(total / pageSize), page = validPage(requested, pages) ? requested : pages;
  const start = (page - 1) * pageSize, end = Math.min(page * pageSize, total);
  return Object.freeze({ page, pages, total, from: start + 1, to: end,
    canEarlier: page > 1, canNewer: page < pages,
    entries: Object.freeze(receipts.slice(start, end).map(receipt => entry(world, receipt))) });
}

/** Trusted input must already have passed the world/codec validation boundary. */
export function projectHistoryPage(world: WorldState, page?: number): HistoryPage {
  return project(world, readActionReceipts(world), page);
}

/** One controller per installed session. Only client crosses the UI boundary. */
export function createHistoryController(initial: WorldState) {
  let world = initial, receipts = readActionReceipts(initial), view = project(world, receipts), disposed = false;
  const listeners = new Set<(page: HistoryPage) => void>();
  function emit() {
    for (const listener of listeners) {
      if (disposed) break;
      try { listener(view); } catch { /* A presentation observer cannot undo a committed action. */ }
    }
  }
  const client: HistoryClient = Object.freeze({
    read: () => view,
    selectPage(page: unknown) {
      if (disposed || !validPage(page, view.pages) || page === view.page) return;
      view = project(world, receipts, page); emit();
    },
    subscribe(listener: (page: HistoryPage) => void) {
      if (disposed) return () => {};
      listeners.add(listener);
      try { listener(view); } catch { /* Same observer isolation as subsequent notifications. */ }
      return () => { listeners.delete(listener); };
    },
  });
  return Object.freeze({ client,
    update(next: WorldState) {
      if (disposed || next.campaign.worldRevision === world.campaign.worldRevision) return;
      const nextReceipts = readActionReceipts(next), nextView = project(next, nextReceipts);
      world = next; receipts = nextReceipts; view = nextView; emit();
    },
    dispose() { disposed = true; listeners.clear(); view = empty; receipts = Object.freeze([]); },
  });
}
