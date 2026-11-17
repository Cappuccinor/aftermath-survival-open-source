import type { WorldState } from '../core/world';
import type { ActionReceipt } from '../core/receipts';
import type { VisibleOutcome } from './ports';
import { projectLocation } from '../core/movement';
import { tinAppearance } from '../core/inspection';

/** Existing rule templates only; safe to restore without dispatch or RNG. */
export function projectReceiptOutcome(state: WorldState, receipt: ActionReceipt): VisibleOutcome {
  if(receipt.rule==='talk-v1')return Object.freeze({summary:'你花了一分钟向周围打招呼。'+(receipt.result==='first_warning'?(receipt.alertnessBefore!<50?'近处传来回应：“我不认识你，别再喊了。”':'近处传来回应：“别靠近。不要再喊。”'):receipt.result==='repeated_warning'?'近处传来回应：“我说过不要再叫。”':'没有听到回应。'),facts:Object.freeze([])});
  const inspecting = receipt.rule === 'inspect-v1';
  const description = receipt.rule === 'observe-v1'
    ? (receipt.visibility === 'clear' ? '光线足够，你能分辨周围的明暗。' : '光线不足，无法看清周围。')
    : tinAppearance.description;
  const door = (receipt.rule === 'door-observe-v1' || receipt.rule === 'door-observe-v2') ? receipt : null;
  const visual = door?.visual === 'shoes' ? '门缝外露出一双旧鞋的轮廓。'
    : door?.visual === 'shadow' ? '门缝外有一道模糊的影子。' : '未能辨清门外的细节。';
  const sound = '门外传来衣料摩擦的轻响。';
  const safeOutcome: VisibleOutcome = receipt.rule === 'cabinet-search-v2' ? Object.freeze({
    summary: receipt.discoveredItemId
      ? '你花了一分钟搜索柜子，发现瓶装水。水仍在柜中。'
      : `你花了一分钟搜索柜子，没有新发现。此前发现的瓶装水${receipt.waterLocation === 'cabinet' ? '仍在柜中' : '已取出'}。`,
    facts: Object.freeze([]),
  }) : receipt.rule === 'pick_up-v2' ? Object.freeze({
    summary: `你花了一分钟拾起${receipt.request.itemId === 'prototype-bottled-water' ? '瓶装水' : '空罐'}。`, facts: Object.freeze([]),
  }) : receipt.rule === 'cabinet-search-v1' ? Object.freeze({
    summary: receipt.discoveredItemId
      ? '你花了一分钟搜索柜子，发现瓶装水。水仍在柜中，当前尚未支持取出。'
      : '你花了一分钟搜索柜子，没有新发现。水仍在柜中，当前尚未支持取出。',
    facts: Object.freeze([]),
  }) : receipt.rule === 'pick_up-v1' ? Object.freeze({
    summary: '你花了一分钟拾起空罐。', facts: Object.freeze([]),
  }) : door ? Object.freeze({
    summary: `你花了一分钟透过门缝观察。${visual}${door.noticed ? sound : ''}`,
    facts: Object.freeze([
      ...(door.visual !== 'none' ? [Object.freeze({ factId: 'door-visual', description: visual })] : []),
      ...(door.noticed ? [Object.freeze({ factId: 'door-sound', description: sound })] : []),
    ]),
  }) : Object.freeze({
    summary: receipt.rule === 'search-v1' ? (receipt.discoveredItemId ? '你花了一分钟搜索房间，发现空罐。' : '你花了一分钟搜索房间，没有新发现。') : receipt.rule === 'move-v1' ? `你花了一分钟来到${projectLocation(state, receipt.request.destinationId)?.label ?? '目的地'}。` : inspecting ? `你花了一分钟检查${tinAppearance.label}。${description}` : `你留在原地，仔细观察了一分钟。${description}`,
    facts: (receipt.rule === 'search-v1' || receipt.rule === 'move-v1') ? Object.freeze([]) : Object.freeze([Object.freeze({ factId: inspecting ? 'inspection-appearance' : 'observation-light', description })]),
  });
  return safeOutcome;
}
