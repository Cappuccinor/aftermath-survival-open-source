// Run against `npm run build` then `npm run preview -- --port 4173 --strictPort`.
// Set PLAYWRIGHT_MODULE_PATH to an installed Playwright package when it is not on NODE_PATH.
// Optional: node scripts/verify-observation-ui.cjs <evidence-directory> --inspection
// Default is ignored scratch, so reruns cannot overwrite accepted historical evidence.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const origin = 'http://127.0.0.1:4173';
const includeBuilding = process.argv.includes('--building-scene');
const includePickup = process.argv.includes('--pickup');
const includeDoorGap = process.argv.includes('--door-gap');
const includeStatus = process.argv.includes('--status');
const includeCharacter = process.argv.includes('--character');
const includeSearch = process.argv.includes('--search');
const includeMovement = process.argv.includes('--movement') || includeSearch;
const includeInspection = process.argv.includes('--inspection') || includeMovement;
const evidenceDir = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '.superpowers/browser-observation');
fs.mkdirSync(evidenceDir, { recursive: true });
const artifactFiles = fs.readdirSync('dist', { recursive: true }).filter(file => fs.statSync(path.join('dist', file)).isFile());
const sourceFiles = [...fs.readdirSync('src', { recursive: true }).filter(file => fs.statSync(path.join('src', file)).isFile()).map(file => `src/${file.replaceAll('\\', '/')}`),
  'index.html', 'package.json', 'package-lock.json', 'scripts/verify-observation-ui.cjs', 'scripts/verify-character-ui.cjs', 'scripts/verify-player-status-ui.cjs', 'scripts/verify-door-gap-ui.cjs', 'scripts/verify-pickup-ui.cjs', 'scripts/verify-building-scene-ui.cjs'];
const sourceBlobs = cp.execFileSync('git', ['hash-object', '--', ...sourceFiles], { encoding: 'utf8' }).trim().split(/\r?\n/);
const evidence = { taskId: includeBuilding ? 'G1-010' : includePickup ? 'G1-009' : includeDoorGap ? 'G1-008' : includeStatus ? 'G1-007' : includeCharacter ? 'G1-006' : includeSearch ? 'G1-005' : includeMovement ? 'G1-004' : includeInspection ? 'G1-003' : 'observation-regression', status: 'running', observedAt: new Date().toISOString(),
  sourceHead: cp.execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceWorktreeDirty: cp.execFileSync('git', ['diff', '--name-only', 'HEAD'], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean),
  platform: process.platform, node: process.version, origin, artifactPath: path.resolve('dist'),
  sourceFiles: sourceFiles.map((file, index) => ({ file, gitBlob: sourceBlobs[index] })),
  artifacts: artifactFiles.map(file => ({ file: file.replaceAll('\\', '/'), bytes: fs.statSync(path.join('dist', file)).size,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join('dist', file))).digest('hex') })), runs: [] };

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  evidence.browser = await browser.version();
  try {
    for (const viewport of [{ width: 1280, height: 900 }, { width: 360, height: 800 }]) {
      const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
      const page = await context.newPage();
      const errors = []; const requests = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => requests.push(request.url()));
      const run = { viewport, steps: [], screenshots: [], errors, requests };
      evidence.runs.push(run);
      async function shot(name) {
        const file = `${viewport.width}-${name}.png`;
        await page.screenshot({ path: path.join(evidenceDir, file), fullPage: true }); run.screenshots.push(file);
      }
      let clockOffset=0;
      async function clockAt(time) {
        const mins=Number(time.slice(3))+clockOffset;time=`08:${String(mins).padStart(2,'0')}`;
        await page.waitForFunction(expected => document.querySelector('#clock').textContent.includes(expected), time);
        assert.ok((await page.locator('#clock').textContent()).includes(time));
      }
      const response = await page.goto(origin);
      assert.equal(await response.text(), fs.readFileSync('dist/index.html', 'utf8'), 'must serve final dist HTML');
      if (includeBuilding) {
        await require('./verify-building-scene-ui.cjs')({ page, run, viewport, shot });
        assert.deepEqual(errors, []); assert.ok(requests.every(url => url.startsWith(origin)));
        run.status = 'passed'; await context.close(); continue;
      }
      if (includePickup) {
        await require('./verify-pickup-ui.cjs')({ page, run, viewport, shot });
        assert.deepEqual(errors, []); assert.ok(requests.every(url => url.startsWith(origin)));
        run.status = 'passed'; await context.close(); continue;
      }
      if (includeDoorGap) {
        await require('./verify-door-gap-ui.cjs')({ page, run, viewport, shot });
        assert.deepEqual(errors, []); assert.ok(requests.every(url => url.startsWith(origin)));
        run.status = 'passed'; await context.close(); continue;
      }
      if (includeStatus) {
        await require('./verify-player-status-ui.cjs')({ page, run, viewport, shot });
        assert.deepEqual(errors, []); assert.ok(requests.every(url => url.startsWith(origin)));
        run.status = 'passed'; await context.close(); continue;
      }
      if (includeCharacter) {
        await require('./verify-character-ui.cjs')({ page, run, viewport, shot });
        assert.deepEqual(errors, []); assert.ok(requests.every(url => url.startsWith(origin)));
        run.status = 'passed'; await context.close(); continue;
      }
      assert.equal(await page.locator('#experience').isVisible(), false);
      await shot('landing');
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'enter');
      await page.keyboard.press('Enter'); await clockAt('08:00');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'action');
      await shot('idle'); run.steps.push('Keyboard entered prototype; authority clock 08:00; free input focused.');
      async function prepareInspection(){
        assert.equal(await page.locator('#inspect-targets button').count(),0);
        await page.locator('#search').click();clockOffset=1;await clockAt('08:00');
        run.steps.push('Legacy inspection/movement preparation: search once; all subsequent expected clocks offset +1 minute.');
      }
      if(includeSearch){
        assert.equal(await page.locator('#inspect-targets button').count(),0);
        assert.ok(!(await page.locator('body').textContent()).includes('空罐'));
        await shot('search-initial');
        const search=page.locator('#search');await search.dblclick({delay:40});await clockAt('08:01');
        assert.match(await page.locator('#narrative').textContent(),/发现空罐/);
        assert.equal(await search.evaluate(el=>el===document.activeElement),true);await shot('search-discovered');
        await page.locator('#inspect-targets button').click();await clockAt('08:02');
        await search.click();await clockAt('08:03');assert.match(await page.locator('#narrative').textContent(),/没有新发现/);
        await page.locator('#move-targets button').click();await clockAt('08:04');assert.equal(await search.isVisible(),false);
        await page.locator('#move-targets button').click();await clockAt('08:05');assert.equal(await page.locator('#inspect-targets button').count(),1);
        const free=page.locator('#action');for(const phrase of ['不要搜索房间','我准备搜索房间','搜索房间并拿走','搜索未知地点']){
          await free.fill(phrase);await page.locator('#submit').click();await page.waitForFunction(()=>document.querySelector('#feedback').dataset.phase==='error');await clockAt('08:05');assert.equal(await free.inputValue(),phrase);
        }
        for(const [phrase,time] of [['搜索房间','08:06'],['搜查房间','08:07']]){await free.fill(phrase);await free.press('Control+Enter');await clockAt(time);assert.match(await page.locator('#narrative').textContent(),/没有新发现/);}
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await shot('search-recovered');
        run.steps.push('Undisclosed initial tin; physical double-click searches once, focus retained; inspect/repeat/no-new-findings; leave/return; four refusals preserve draft/time; two text searches recover.');
        clockOffset=0; await page.reload();await page.locator('#enter').click();await clockAt('08:00');
      }
      if (includeMovement) {
        await prepareInspection();
        assert.match(await page.locator('#current-location').textContent(), /房间/);
        await page.getByRole('button', { name: '检查空罐', exact: true }).click(); await clockAt('08:01');
        const move = page.locator('#move-targets button');
        await move.dblclick({ delay: 40 }); await clockAt('08:02');
        assert.match(await page.locator('#current-location').textContent(), /走廊/);
        assert.equal(await page.locator('#inspect-targets button').count(), 0);
        assert.equal(await move.textContent(), '前往房间');
        assert.equal(await move.evaluate(el => el === document.activeElement), true);
        assert.match(await page.locator('#narrative').textContent(), /来到走廊/);
        assert.match(await page.locator('#feedback').textContent(), /尚未保存/);
        await shot('movement-corridor');
        await page.getByRole('button', { name: '观察四周', exact: true }).click(); await clockAt('08:03');
        assert.match(await page.locator('#narrative').textContent(), /无法看清/);
        const free = page.getByLabel('自由行动', { exact: true });
        await free.fill('走到房间'); await free.press('Control+Enter'); await clockAt('08:04');
        assert.match(await page.locator('#current-location').textContent(), /房间/);
        assert.equal(await page.locator('#inspect-targets button').count(), 1);
        for (const rejected of ['我准备离开', '不要前往走廊', '前往走廊然后观察', '前往秘密地点', '前往prototype-corridor']) {
          await free.fill(rejected); await page.locator('#submit').click();
          await page.waitForFunction(() => document.querySelector('#feedback').dataset.phase === 'error');
          assert.equal(await free.inputValue(), rejected); await clockAt('08:04');
          assert.match(await page.locator('#current-location').textContent(), /房间/);
        }
        await free.fill('前往走廊'); await page.locator('#submit').click(); await clockAt('08:05');
        await move.focus(); await page.keyboard.down('Enter'); await page.keyboard.down('Enter'); await page.keyboard.up('Enter'); await clockAt('08:06');
        assert.match(await page.locator('#current-location').textContent(), /房间/);
        assert.equal(await move.evaluate(el => el === document.activeElement), true);
        await page.getByRole('button', { name: '检查空罐', exact: true }).click(); await clockAt('08:07');
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await shot('movement-recovered');
        run.steps.push('Inspect → double-click move once; current corridor, no remote tin, stable focus; dark observe; text return; five refusals preserve draft/time; text recovery, held Enter moves once, inspect returns; no overflow, honest unsaved.');
        clockOffset=0; await page.reload(); await page.getByRole('button', { name: '进入观察体验' }).click(); await clockAt('08:00');
      }
      if (includeInspection) {
        await prepareInspection();
        assert.match(await page.locator('#narrative').textContent(), /空罐/);
        const inspectButton = page.getByRole('button', { name: '检查空罐', exact: true });
        assert.equal(await page.locator('#inspect-targets button').count(), 1);
        await inspectButton.click(); await clockAt('08:01');
        assert.match(await page.locator('#narrative').textContent(), /罐身呈金属质感，罐口敞开/);
        assert.match(await page.locator('#feedback').textContent(), /尚未保存/);
        assert.equal(await page.locator('#history li').count(), 2);
        assert.equal(await inspectButton.evaluate(element => element === document.activeElement), true, 'dynamic button keeps focus');
        const freeInput = page.getByLabel('自由行动', { exact: true });
        await freeInput.fill('查看空罐'); await freeInput.press('Control+Enter'); await clockAt('08:02');
        await freeInput.fill('仔细检查空罐'); await page.locator('#submit').click(); await clockAt('08:03');
        assert.equal(await freeInput.inputValue(), '');
        await shot('inspection-success');
        const lastNarrative = await page.locator('#narrative').textContent();
        for (const text of ['不要检查空罐', '我准备检查空罐', '如果能看见空罐就检查空罐', '先检查空罐再观察四周', '检查空罐并拿走',
          '检查prototype-tin', '检查hidden', '查看柜内空罐', '把空罐数量设为10']) {
          await freeInput.fill(text); await page.locator('#submit').click();
          await page.waitForFunction(() => document.querySelector('#feedback').dataset.phase === 'error');
          await clockAt('08:03'); assert.equal(await freeInput.inputValue(), text);
          assert.equal(await page.locator('#narrative').textContent(), lastNarrative);
          assert.equal(await page.locator('#inspect-targets button').count(), 1);
        }
        await shot('inspection-rejected');
        await page.locator('#observe').click(); await clockAt('08:04');
        await freeInput.fill('检查空罐'); await freeInput.press('Control+Enter'); await clockAt('08:05');
        await shot('inspection-recovered');
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        for (const selector of ['#inspect-targets', '#action', '#submit', '#feedback']) {
          await page.locator(selector).scrollIntoViewIfNeeded();
          const rect = await page.locator(selector).boundingBox();
          assert.ok(rect.x >= 0 && rect.x + rect.width <= viewport.width + 1 && rect.y < viewport.height && rect.y + rect.height > 0);
        }
        run.steps.push('Core-backed initial target; inspection button and two texts reach 08:03; nine rejected probes retain draft/facts/time; observe/inspect recover to 08:05.');
        clockOffset=0; await page.reload(); await page.locator('#enter').click(); await clockAt('08:00');
        await prepareInspection();
        await inspectButton.dblclick({ delay: 40 });
        await clockAt('08:01');
        assert.equal(await page.locator('#history li').count(), 2);
        await inspectButton.focus(); await page.keyboard.down('Enter'); await page.keyboard.down('Enter'); await page.keyboard.up('Enter');
        await clockAt('08:02'); assert.equal(await page.locator('#history li').count(), 3);
        await freeInput.fill('检查空罐'); await page.locator('#submit').dblclick({ delay: 40 });
        await clockAt('08:03'); assert.equal(await page.locator('#history li').count(), 3);
        run.steps.push('Stable dynamic target focus; inspection physical double-click, held Enter and submit double-click each settle once; no horizontal overflow.');
        clockOffset=0; await page.reload(); await page.locator('#enter').click(); await clockAt('08:00');
      }
      await page.getByRole('button', { name: '观察四周', exact: false }).click(); await clockAt('08:01');
      assert.equal(await page.locator('#history li').count(), 1);
      assert.match(await page.locator('#narrative').textContent(), /光线足够/); // G1-003 trusted fixture has sufficient light.
      assert.match(await page.locator('#feedback').textContent(), /本次行动已完成.*尚未保存/);
      const input = page.getByLabel('自由行动', { exact: true });
      await input.fill('看看周围'); await input.press('Control+Enter'); await clockAt('08:02');
      assert.equal(await input.inputValue(), ''); assert.equal(await page.locator('#history li').count(), 2);
      await shot('success'); run.steps.push('Button and equivalent free text committed once each: 08:01, 08:02; unsaved feedback.');
      // Door observation is now supported; its compound extension must still be rejected.
      for (const text of ['寻找水', '不要观察四周', '先观察再离开', '我准备离开', '把饥饿设成0', '观察门缝并离开', '未知'.repeat(2500), '<img src=x onerror="document.title=\'INJECTED\'">观察四周']) {
        await input.fill(text); await page.getByRole('button', { name: '提交行动' }).click();
        await page.waitForFunction(() => document.querySelector('#feedback').dataset.phase === 'error');
        await clockAt('08:02'); assert.equal(await input.inputValue(), text);
        assert.equal(await page.locator('#history li').count(), 2); assert.equal(await input.isEnabled(), true);
        assert.equal(await page.locator('#action-form img').count(), 0);
        assert.equal(await page.title(), '末日余生 · 居民楼交互原型');
      }
      await shot('rejected'); run.steps.push('Eight unsupported/negated/compound/preparatory/cheating/compound-door-gap/long/HTML inputs rejected; draft and 08:02 preserved.');
      await input.fill('原地观察'); await input.press('Enter'); await clockAt('08:02');
      assert.equal(await page.locator('#history li').count(), 2);
      await input.fill('原地观察');
      await input.dispatchEvent('keydown', { key: 'Enter', ctrlKey: true, isComposing: true, bubbles: true });
      assert.equal(await page.locator('#history li').count(), 2);
      await input.press('Control+Enter'); await clockAt('08:03');
      assert.equal(await page.locator('#history li').count(), 3);
      const layout = await page.evaluate(() => ({ width: innerWidth, height: innerHeight,
        documentWidth: document.documentElement.scrollWidth, pageHeight: document.documentElement.scrollHeight }));
      assert.equal(layout.width, viewport.width); assert.ok(layout.documentWidth <= viewport.width);
      for (const selector of ['#narrative', '#action', '#submit', '#feedback']) {
        const target = page.locator(selector); await target.scrollIntoViewIfNeeded();
        assert.equal(await target.isVisible(), true);
        const rect = await target.boundingBox(); assert.ok(rect.x >= 0 && rect.x + rect.width <= viewport.width + 1);
        assert.ok(rect.y < viewport.height && rect.y + rect.height > 0);
      }
      run.layout = layout;
      await page.evaluate(() => scrollTo(0, 0)); await shot('recovered');
      run.steps.push('Enter/IME do not submit; Ctrl+Enter recovers to 08:03; narrative/input/submit/feedback reachable with no horizontal overflow.');
      clockOffset=0; await page.reload(); await page.getByRole('button', { name: '进入观察体验' }).click(); await clockAt('08:00');
      assert.equal(await page.locator('#history li').count(), 0);
      await page.getByRole('button', { name: '观察四周' }).dblclick({ delay: 40 });
      assert.match(await page.locator('#clock').textContent(), /08:01/, 'one physical double click must commit only once');
      assert.equal(await page.locator('#history li').count(), 1);
      await page.getByRole('button', { name: '观察四周' }).focus();
      await page.keyboard.down('Enter'); await page.keyboard.down('Enter'); await page.keyboard.up('Enter');
      await clockAt('08:02'); assert.equal(await page.locator('#history li').count(), 2);
      run.steps.push('Refresh explicitly resets unsaved prototype; physical double-click settles only once.');
      assert.deepEqual(errors, []); assert.ok(requests.every(url => url.startsWith(origin)));
      run.status = 'passed'; await context.close();
    }
    evidence.status = 'passed';
  } finally { await browser.close(); }
})().catch(error => { evidence.status = 'failed'; evidence.error = error.stack; process.exitCode = 1; })
  .finally(() => { fs.writeFileSync(path.join(evidenceDir, 'browser-results.json'), JSON.stringify(evidence, null, 2) + '\n');
    console.log(JSON.stringify({ status: evidence.status, browser: evidence.browser, runs: evidence.runs.map(run => ({ viewport: run.viewport, status: run.status, steps: run.steps.length })), error: evidence.error }, null, 2)); });
