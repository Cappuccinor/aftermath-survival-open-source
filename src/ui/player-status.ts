import type { VisiblePlayerStatus } from '../application/ports';

const fields = [
  ['hp', '生命', '越高越好'], ['stamina', '体力', '越高越好'], ['mental', '精神', '越高越好'],
  ['hunger', '饥饿', '越高越糟'], ['thirst', '口渴', '越高越糟'], ['fatigue', '疲劳', '越高越糟'],
  ['infection', '感染', '越高越糟'], ['pain', '疼痛', '越高越糟'],
  ['bodyTempC', '体温', '摄氏度'], ['carryWeightKg', '负重', '千克'],
] as const;

/** Stable native disclosure; viewing one's status has no action capability. */
export function createPlayerStatusPanel(doc: Document): {
  element: HTMLElement; render(status: VisiblePlayerStatus | null): void;
} {
  const element = doc.createElement('section'); element.className = 'player-status-panel';
  element.setAttribute('aria-label', '自身状态');
  const details = doc.createElement('details'); details.id = 'player-status';
  const summary = doc.createElement('summary');
  const summaryText = doc.createElement('span'); summary.append(summaryText);
  const unavailable = doc.createElement('p'); unavailable.id = 'player-status-unavailable';
  unavailable.textContent = '状态暂不可用';
  const values = doc.createElement('div'); values.id = 'player-status-values';
  const rows = fields.map(([key, name, direction]) => {
    const row = doc.createElement('div'); row.dataset.stat = key; row.className = 'status-row';
    const label = doc.createElement('span'); label.id = `status-label-${key}`; label.textContent = name;
    const value = doc.createElement('span'); value.className = 'status-value';
    const hint = doc.createElement('span'); hint.id = `status-hint-${key}`; hint.className = 'status-direction';
    hint.textContent = direction;
    const isMeter = key !== 'bodyTempC' && key !== 'carryWeightKg';
    const meter = isMeter ? doc.createElement('meter') : null;
    row.append(label, value);
    if (meter) {
      meter.min = 0; meter.max = 100;
      // Native colour semantics match the textual direction without medical thresholds.
      meter.optimum = direction === '越高越好' ? 100 : 0;
      meter.setAttribute('aria-labelledby', label.id); meter.setAttribute('aria-describedby', hint.id);
      row.append(meter);
    }
    row.append(hint); values.append(row);
    return { key, value, meter };
  });
  details.append(summary, unavailable, values);
  const notice = doc.createElement('p'); notice.id = 'player-status-notice'; notice.className = 'hint';
  notice.textContent = '拾取会改变负重；当前尚未模拟生存消耗。';
  element.append(details, notice);
  function render(status: VisiblePlayerStatus | null) {
    summaryText.textContent = status
      ? `自身状态 · 生命 ${status.hp} · 体力 ${status.stamina} · 精神 ${status.mental}`
      : '自身状态 · 状态暂不可用';
    unavailable.hidden = status !== null; values.hidden = status === null;
    for (const { key, value, meter } of rows) {
      value.textContent = status === null ? '' : `${status[key]}${key === 'bodyTempC' ? ' °C' : key === 'carryWeightKg' ? ' kg' : ' / 100'}`;
      if (meter && status !== null) meter.value = status[key];
    }
  }
  render(null);
  return { element, render };
}
