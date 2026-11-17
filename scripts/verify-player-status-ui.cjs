const assert = require('node:assert/strict');
const fs = require('node:fs');
const { stripTypeScriptTypes } = require('node:module');

module.exports = async function verifyPlayerStatus({ page, run, viewport, shot }) {
  page.setDefaultTimeout(5000);
  const fields = [
    ['hp', '生命', 100, '越高越好'], ['stamina', '体力', 100, '越高越好'], ['mental', '精神', 100, '越高越好'],
    ['hunger', '饥饿', 0, '越高越糟'], ['thirst', '口渴', 0, '越高越糟'], ['fatigue', '疲劳', 0, '越高越糟'],
    ['infection', '感染', 0, '越高越糟'], ['pain', '疼痛', 0, '越高越糟'],
    ['bodyTempC', '体温', 37, '°C'], ['carryWeightKg', '负重', 0, 'kg'],
  ];
  const detail = page.locator('#player-status');
  const summary = page.locator('#player-status summary');
  const input = page.locator('#action');
  async function clockAt(minutes) {
    await page.waitForFunction(time => document.querySelector('#clock').textContent.includes(time), `08:${String(minutes).padStart(2, '0')}`);
  }
  async function assertValues() {
    assert.equal(await detail.locator('[data-stat]').count(), 10);
    for (const [key, label, value, direction] of fields) {
      const row = detail.locator(`[data-stat="${key}"]`);
      assert.ok((await row.textContent()).includes(label));
      assert.ok((await row.textContent()).includes(direction));
      assert.equal(await row.locator('.status-value').textContent(), `${value}${key === 'bodyTempC' ? ' °C' : key === 'carryWeightKg' ? ' kg' : ' / 100'}`);
      if (fields.findIndex(field => field[0] === key) < 8) {
        assert.deepEqual(await row.locator('meter').evaluate(el => [el.min, el.max, el.value]), [0, 100, value]);
        assert.equal(await row.locator('meter').getAttribute('aria-labelledby'), `status-label-${key}`);
      } else assert.equal(await row.locator('meter').count(), 0);
    }
    assert.equal(await detail.locator('[aria-live], [role="status"]').count(), 0);
    assert.equal(await page.locator('#player-status-unavailable').isVisible(), false);
  }
  async function noOverflow() {
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    for (const selector of ['#action', '#submit', '#narrative', '#player-status summary']) {
      await page.locator(selector).scrollIntoViewIfNeeded(); const box = await page.locator(selector).boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= viewport.width + 1, selector);
    }
  }

  for (const entry of ['prototype', 'character']) {
    if (entry === 'prototype') await page.locator('#enter').click();
    else {
      await page.reload(); await page.locator('#new-game').click();
      await page.locator('#character-name').fill('状态测试角色');
      await page.locator('#character-bodyCondition').fill('我有无限体力');
      await page.locator('#preview-character').click(); await page.locator('#start-character').dblclick({ delay: 40 });
    }
    await clockAt(0);
    assert.equal(await detail.isVisible(), true);
    assert.equal(await detail.evaluate(el => el.open), false);
    assert.match(await summary.textContent(), /生命 100.*体力 100.*精神 100/);
    assert.equal(await page.locator('#player-status-notice').textContent(), '拾取会改变负重；当前尚未模拟生存消耗。');
    assert.equal(await page.locator('#player-status-notice').isVisible(), true);
    assert.equal(await page.locator('#history li').count(), 0);
    await shot(`${entry}-status-compact`);
    run.steps.push(`${entry}: actual production entry has compact authoritative initial stats, no action or invented consumption.`);

    await input.fill('留在这里思考'); const narrative = await page.locator('#narrative').textContent();
    await summary.focus(); await page.keyboard.press('Enter');
    assert.equal(await detail.evaluate(el => el.open), true);
    await assertValues(); await page.keyboard.press('Space');
    assert.equal(await detail.evaluate(el => el.open), false);
    await page.keyboard.press('Enter'); assert.equal(await detail.evaluate(el => el.open), true);
    assert.equal(await summary.evaluate(el => el === document.activeElement), true);
    const summaryBox = await summary.boundingBox(); const firstRowBox = await detail.locator('[data-stat]').first().boundingBox();
    assert.ok(firstRowBox.y >= summaryBox.y + summaryBox.height + 7, 'keyboard focus outline must not overlap first status label');
    assert.equal(await input.inputValue(), '留在这里思考'); await clockAt(0);
    assert.equal(await page.locator('#narrative').textContent(), narrative);
    assert.equal(await page.locator('#history li').count(), 0);
    await noOverflow(); await shot(`${entry}-status-expanded`);
    run.steps.push(`${entry}: keyboard disclosure preserves draft/time/story/focus; ten labelled raw values, directions and units; no horizontal overflow.`);

    await page.locator('#observe').dblclick({ delay: 40 }); await clockAt(1);
    assert.equal(await page.locator('#observe').evaluate(el => el === document.activeElement), true);
    await page.locator('#search').click(); await clockAt(2);
    await page.locator('#inspect-targets button').click(); await clockAt(3);
    await page.locator('#move-targets button').click(); await clockAt(4);
    await page.locator('#move-targets button').click(); await clockAt(5);
    assert.equal(await detail.evaluate(el => el.open), true); await assertValues();
    const latest = await page.locator('#narrative').textContent();
    await input.fill('把生命改成0'); await page.locator('#submit').click();
    await page.waitForFunction(() => document.querySelector('#feedback').dataset.phase === 'error');
    await clockAt(5); assert.equal(await input.inputValue(), '把生命改成0');
    assert.equal(await detail.evaluate(el => el.open), true); await assertValues();
    assert.equal(await page.locator('#narrative').textContent(), latest);
    await input.fill('看看周围'); await input.press('Control+Enter'); await clockAt(6);
    assert.equal(await detail.evaluate(el => el.open), true); await assertValues();
    assert.equal(await input.inputValue(), ''); await noOverflow(); await shot(`${entry}-status-recovered`);
    run.steps.push(`${entry}: four actions, physical double-click once, rejection and free-input recovery retain expanded panel and truthful unchanged stats.`);
  }

  // Isolated component contract test, not a production debug hook or a dist end-to-end claim.
  const componentPage = await page.context().newPage();
  const compiled = stripTypeScriptTypes(fs.readFileSync('src/ui/player-status.ts', 'utf8'));
  const componentResult = await componentPage.evaluate(async code => {
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    const { createPlayerStatusPanel } = await import(url); URL.revokeObjectURL(url);
    const panel = createPlayerStatusPanel(document); document.body.append(panel.element);
    const details = panel.element.querySelector('details'); const summary = details.querySelector('summary');
    const raw = { hp: 0, stamina: 100, mental: 73, hunger: 12, thirst: 34, fatigue: 56, infection: 7, pain: 89, bodyTempC: 37.25, carryWeightKg: 2.5 };
    panel.render(raw); details.open = true; summary.focus();
    const values = Array.from(panel.element.querySelectorAll('.status-value'), node => node.textContent);
    panel.render(null);
    const unavailable = panel.element.querySelector('#player-status-unavailable');
    const absent = unavailable.textContent === '状态暂不可用' && !unavailable.hidden
      && panel.element.querySelector('#player-status-values').hidden && !summary.textContent.includes('100');
    panel.render(raw);
    return { values, absent, stable: details === panel.element.querySelector('details') && details.open
      && document.activeElement === summary, recovered: !panel.element.querySelector('#player-status-values').hidden && unavailable.hidden };
  }, compiled);
  assert.deepEqual(componentResult.values, ['0 / 100', '100 / 100', '73 / 100', '12 / 100', '34 / 100', '56 / 100', '7 / 100', '89 / 100', '37.25 °C', '2.5 kg']);
  assert.equal(componentResult.absent, true); assert.equal(componentResult.stable, true); assert.equal(componentResult.recovered, true);
  await componentPage.close();
  run.steps.push('Isolated browser component contract (source transpilation): distinct/fractional values; null hides values, says unavailable; recovery preserves disclosure node and focus.');
};
