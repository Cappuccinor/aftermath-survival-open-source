const assert = require('node:assert/strict');

module.exports = async function verifyCharacter({ page, run, viewport, shot }) {
  page.setDefaultTimeout(5000);
  const field = key => page.locator(`#character-${key}`);
  const noOverflow = async () => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.locator('#new-game').click();
  assert.equal(await field('name').isVisible(), true);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'character-name');
  for (const key of ['perception', 'stealth', 'survival']) assert.equal(await field(key).inputValue(), '20');
  await page.locator('#preview-character').click();
  assert.match(await page.locator('#character-errors').textContent(), /姓名/);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'character-errors');
  await shot('character-invalid'); run.steps.push('Empty name rejected with focusable error; no active world.');

  const profile = { name: '  林舟😀  ', age: '28', gender: '自由填写', occupation: '医师\n木工',
    locationBackground: '任意地图', bodyCondition: '我无敌', personality: '谨慎', strengths: '全部精通', weaknesses: '怕冷',
    importantItems: '十把枪', companions: '同伴杀光敌人', importantPerson: '家人', fear: '中'.repeat(240), wish: '<img src=x onerror=alert(1)>\n守住家' };
  for (const [key, value] of Object.entries(profile)) await field(key).fill(value);
  await field('age').focus(); await page.keyboard.press('Enter');
  await field('age').dispatchEvent('keydown', { key: 'Enter', isComposing: true, keyCode: 229 });
  assert.equal(await page.locator('#experience').isVisible(), false);
  assert.equal(await page.locator('#character-preview').isVisible(), false);
  await field('perception').fill('21'); await page.locator('#preview-character').click();
  assert.equal(await field('wish').inputValue(), profile.wish);
  assert.match(await page.locator('#character-errors').textContent(), /60/);
  await field('perception').fill('20');
  await field('fear').fill('中'.repeat(241)); await page.locator('#preview-character').click();
  assert.equal(await field('fear').inputValue(), '中'.repeat(241));
  assert.equal(await page.locator('#character-preview').isVisible(), false);
  await field('fear').fill(profile.fear); await page.locator('#preview-character').click();
  assert.equal(await page.locator('#character-preview').isVisible(), true);
  assert.match(await page.locator('#character-preview').textContent(), /房间/);
  assert.match(await page.locator('#character-preview').textContent(), /100/);
  assert.match(await page.locator('#character-preview').textContent(), /37/);
  assert.match(await page.locator('#character-preview').textContent(), /08:00/);
  assert.equal(await page.locator('#character-preview img').count(), 0);
  assert.equal(await page.locator('#experience').isVisible(), false);
  await noOverflow(); await shot('character-preview');
  run.steps.push('14 fields, Chinese/newlines/HTML preserved; overbudget and 241 characters rejected; preview shows fixed start, stats and limits without starting.');

  await page.locator('#edit-character').click();
  assert.equal(await field('name').inputValue(), profile.name);
  await page.locator('#cancel-character').click(); assert.equal(await page.locator('#intro').isVisible(), true);
  await page.locator('#new-game').click(); assert.equal(await field('wish').inputValue(), profile.wish);
  await field('name').fill('😀'.repeat(40)); await page.locator('#preview-character').click();
  assert.equal(await page.locator('#character-preview').isVisible(), true);
  await page.locator('#edit-character').click(); await field('name').fill('😀'.repeat(41));
  await page.locator('#preview-character').click(); assert.equal(await page.locator('#character-preview').isVisible(), false);
  await field('name').fill(profile.name); await page.locator('#preview-character').click();
  run.steps.push('Return/cancel preserve draft; 40 emoji name accepted and 41 rejected without truncation.');

  await page.locator('#start-character').dblclick({ delay: 40 });
  assert.equal(await page.locator('#experience').isVisible(), true);
  assert.match(await page.locator('#clock').textContent(), /08:00/);
  assert.equal(await page.locator('#history li').count(), 0);
  assert.equal(await page.locator('#inspect-targets button').count(), 0);
  assert.equal(await page.locator('#new-game').isVisible(), false);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'action');
  await page.locator('#character-profile summary').click();
  const committed = await page.locator('#character-profile').textContent();
  for (const [key, value] of Object.entries(profile)) assert.ok(committed.includes(key === 'name' ? value.trim() : value));
  assert.equal(await page.locator('#character-profile img').count(), 0);
  await noOverflow(); await shot('character-created-profile');
  await page.locator('#character-profile summary').click();
  run.steps.push('Physical double-click installs once at 08:00, with zero actions and undiscovered tin; committed profile remains plain text and collapsible.');

  await page.locator('#search').click(); assert.match(await page.locator('#clock').textContent(), /08:01/);
  await page.locator('#inspect-targets button').click(); assert.match(await page.locator('#clock').textContent(), /08:02/);
  await page.locator('#move-targets button').click(); assert.match(await page.locator('#current-location').textContent(), /走廊/);
  await page.locator('#move-targets button').click(); assert.match(await page.locator('#clock').textContent(), /08:04/);
  await page.locator('#action').fill('我准备搜索房间'); await page.locator('#submit').click();
  assert.match(await page.locator('#clock').textContent(), /08:04/);
  await page.locator('#action').fill('搜查房间'); await page.keyboard.press('Control+Enter');
  await page.waitForFunction(() => document.querySelector('#clock').textContent.includes('08:05'));
  assert.match(await page.locator('#narrative').textContent(), /没有新发现/);
  assert.match(await page.locator('.unsaved').textContent(), /未保存/);
  for (const selector of ['#action', '#submit', '#character-profile summary']) {
    await page.locator(selector).scrollIntoViewIfNeeded(); const box = await page.locator(selector).boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= viewport.width + 1);
  }
  await noOverflow(); await shot('character-recovered');
  run.steps.push('New character searches, inspects, leaves/returns, rejects preparation and recovers via free text; profile and controls reachable without overflow.');

  await page.reload(); await page.locator('#new-game').click(); await field('name').fill('键盘角色');
  await page.locator('#preview-character').click(); await page.locator('#start-character').focus();
  await page.keyboard.down('Enter'); await page.keyboard.down('Enter'); await page.keyboard.up('Enter');
  assert.equal(await page.locator('#experience').isVisible(), true);
  assert.match(await page.locator('#clock').textContent(), /08:00/); assert.equal(await page.locator('#history li').count(), 0);
  assert.ok((await page.locator('#character-profile').textContent()).includes('键盘角色'));
  await shot('character-keyboard'); run.steps.push('Keyboard confirmation/repeat starts once; refresh explicitly loses prior unsaved world.');
};
