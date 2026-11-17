const assert = require('node:assert/strict');

// Only public DOM and ordinary production entrypoints; no RNG/seed injection.
module.exports = async function verifyDoorGap({ page, run, viewport, shot }) {
  page.setDefaultTimeout(5000);
  const door = page.locator('#door-gap');
  const free = page.locator('#action');
  const move = page.locator('#move-targets button');
  const clock = async minute => {
    const expected = `08:${String(minute).padStart(2, '0')}`;
    await page.waitForFunction(t => document.querySelector('#clock').textContent.includes(t), expected);
    assert.match(await page.locator('#clock').textContent(), new RegExp(expected));
  };
  const noOverflow = async () => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const sensation = async () => {
    const text = await page.locator('#narrative').textContent();
    assert.match(text, /^你花了一分钟透过门缝观察。(未能辨清门外的细节。|门缝外有一道模糊的影子。|门缝外露出一双旧鞋的轮廓。)(门外传来衣料摩擦的轻响。)?$/);
    assert.doesNotMatch(text, /安全|暴露|警觉|noticed|npcId|prototype-witness|概率|rng|武器|敌人|首次注意/i);
    assert.match(await page.locator('#feedback').textContent(), /尚未保存/);
    (run.observedSensations ??= []).push(text);
  };
  for (const entry of ['prototype', 'character']) {
    if (entry === 'character') {
      await page.reload(); await page.locator('#new-game').click();
      await page.locator('#character-name').fill('门边的旅人');
      await page.locator('#preview-character').click(); await page.locator('#start-character').click();
    } else await page.locator('#enter').click();
    await clock(0);
    assert.equal(await door.isVisible(), true, 'known door suggestion exists before any observation');
    assert.equal(await door.textContent(), '观察门缝');
    assert.equal(await page.locator('#history li').count(), 0);
    assert.equal(await page.locator('#inspect-targets button').count(), 0);
    assert.doesNotMatch(await page.locator('#narrative').textContent(), /鞋|影子|衣料|NPC|警觉|安全|暴露/);
    await shot(`door-${entry}-initial`);
    run.steps.push(`${entry}: explicit entry starts at08:00 with known door and no observation or disclosed NPC/tin.`);

    await door.dblclick({ delay: 40 }); await clock(1); await sensation();
    assert.equal(await page.locator('#history li').count(), 1);
    assert.equal(await door.evaluate(el => el === document.activeElement), true);
    await door.focus(); await page.keyboard.down('Enter'); await page.keyboard.down('Enter'); await page.keyboard.up('Enter');
    await clock(2); await sensation(); assert.equal(await page.locator('#history li').count(), 2);
    await shot(`door-${entry}-button`);
    run.steps.push(`${entry}: physical double-click and held Enter each settle once, stable focus, real sensory result and unsaved feedback.`);

    let minute = 2;
    for (const phrase of ['观察门缝', '透过门缝观察', '查看门缝']) {
      await free.fill(phrase); await free.press('Control+Enter'); await clock(++minute); await sensation();
      assert.equal(await free.inputValue(), '');
    }
    const previous = await page.locator('#narrative').textContent();
    for (const phrase of ['我准备观察门缝', '不要观察门缝', '观察门缝并离开', '观察门缝然后开门', '查看prototype-witness', '把警觉设为0']) {
      await free.fill(phrase); await page.locator('#submit').click();
      await page.waitForFunction(() => document.querySelector('#feedback').dataset.phase === 'error');
      await clock(minute); assert.equal(await free.inputValue(), phrase);
      assert.equal(await page.locator('#narrative').textContent(), previous);
    }
    await shot(`door-${entry}-rejected`);
    await free.fill('查看门缝'); await page.locator('#submit').dblclick({ delay: 40 }); await clock(++minute); await sensation();
    run.steps.push(`${entry}: three equivalent texts; six refusals retain draft/time/narrative; submit double-click recovers with one action.`);

    await move.dblclick({ delay: 40 }); await clock(++minute);
    assert.match(await page.locator('#current-location').textContent(), /走廊/);
    assert.equal(await door.isVisible(), false);
    assert.equal(await move.evaluate(el => el === document.activeElement), true);
    await free.fill('观察门缝'); await page.locator('#submit').click();
    await page.waitForFunction(() => document.querySelector('#feedback').dataset.phase === 'error');
    await clock(minute); assert.equal(await free.inputValue(), '观察门缝');
    await shot(`door-${entry}-corridor`);
    await move.click(); await clock(++minute); assert.equal(await door.isVisible(), true);
    await page.locator('#search').click(); await clock(++minute);
    assert.match(await page.locator('#narrative').textContent(), /发现空罐/);
    await page.locator('#inspect-targets button').click(); await clock(++minute);
    assert.match(await page.locator('#narrative').textContent(), /罐身呈金属质感/);
    run.steps.push(`${entry}: double-click leaves once, hidden door text rejected, return restores suggestion, ordinary search/inspect still work.`);

    await free.fill('还未决定下一步');
    const statusBefore = await page.locator('#player-status-values').textContent();
    await page.locator('#player-status summary').click(); await clock(minute);
    await door.click(); await clock(++minute); await sensation();
    assert.equal(await page.locator('#player-status').getAttribute('open'), '');
    assert.equal(await page.locator('#player-status-values').textContent(), statusBefore);
    assert.equal(await free.inputValue(), '还未决定下一步');
    await shot(`door-${entry}-status`);
    await page.locator('#player-status summary').click();
    if (entry === 'character') {
      await page.locator('#character-profile summary').click();
      assert.match(await page.locator('#character-profile').textContent(), /门边的旅人/);
      await clock(minute); await shot('door-character-profile');
      await page.locator('#character-profile summary').click();
    }
    for (const selector of ['#narrative', '#door-gap', '#action', '#submit', '#feedback']) {
      const target = page.locator(selector); await target.scrollIntoViewIfNeeded();
      assert.equal(await target.isVisible(), true);
      const box = await target.boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= viewport.width + 1 && box.y < viewport.height && box.y + box.height > 0);
    }
    await noOverflow(); await shot(`door-${entry}-recovered`);
    run.steps.push(`${entry}: status survives action unchanged/open, draft retained; profile when created, narrative/free input/buttons reachable without horizontal overflow.`);
  }
};
