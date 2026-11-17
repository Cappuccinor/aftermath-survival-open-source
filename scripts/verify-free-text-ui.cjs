// Real production bootstrap only. Build and preview on port 4173 before running.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const assert = require('node:assert/strict'), crypto = require('node:crypto');
const origin = 'http://127.0.0.1:4173';
const dir = path.resolve(process.argv[2] || '.superpowers/browser-free-text');
fs.mkdirSync(dir, { recursive: true });
const filesIn = root => fs.readdirSync(root, { recursive: true }).filter(f => fs.statSync(path.join(root, f)).isFile()).map(f => `${root}/${f.replaceAll('\\', '/')}`);
const sources = [...filesIn('src'), ...filesIn('scripts'), 'index.html', 'package.json', 'package-lock.json'];
const git = (...args) => cp.execFileSync('git', args, { encoding: 'utf8' }).trim();
const hashes = git('hash-object', '--', ...sources).split(/\r?\n/);
const evidence = { taskId: 'G1-012', status: 'running', observedAt: new Date().toISOString(), sourceHead: git('rev-parse', 'HEAD'),
  sourceWorktreeDirty: git('diff', '--name-only', 'HEAD').split(/\r?\n/).filter(Boolean), platform: process.platform, node: process.version, origin,
  sourceFiles: sources.map((file, i) => ({ file, gitBlob: hashes[i] })),
  artifacts: filesIn('dist').map(file => ({ file: file.slice(5), bytes: fs.statSync(file).size, sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') })), runs: [] };
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  evidence.browser = browser.version();
  try {
    for (const viewport of [{ width: 1280, height: 900 }, { width: 360, height: 800 }]) {
      const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
      const page = await context.newPage(); page.setDefaultTimeout(5000);
      const run = { viewport, steps: [], screenshots: [], errors: [], requests: [] }; evidence.runs.push(run);
      page.on('pageerror', error => run.errors.push(error.message)); page.on('request', request => run.requests.push(request.url()));
      const input = page.locator('#action'); let minutes = 0;
      async function clock() {
        const time = `08:${String(minutes).padStart(2, '0')}`;
        await page.waitForFunction(t => document.querySelector('#clock').textContent.includes(t), time);
        assert.match(await page.locator('#clock').textContent(), new RegExp(time));
      }
      async function shot(name) {
        const file = `${viewport.width}-${name}.png`;
        await page.screenshot({ path: path.join(dir, file), fullPage: true }); run.screenshots.push(file);
      }
      async function success(text, method = 'keyboard') {
        await input.fill(text);
        if (method === 'double') await page.locator('#submit').dblclick({ delay: 40 });
        else await input.press('Control+Enter');
        minutes++; await clock();
        assert.equal(await page.locator('#feedback').getAttribute('data-phase'), 'success');
        assert.equal(await input.inputValue(), '');
        assert.match(await page.locator('#feedback').textContent(), /尚未保存/);
        if (method === 'keyboard') assert.equal(await page.evaluate(() => document.activeElement.id), 'action');
      }
      async function refuse(text) {
        const narrative = await page.locator('#narrative').textContent(), history = await page.locator('#history').textContent();
        const inventory = await page.locator('#inventory').textContent(), status = await page.locator('#player-status').textContent();
        await input.fill(text); await input.press('Control+Enter');
        await page.waitForFunction(() => document.querySelector('#feedback').dataset.phase === 'error');
        await clock(); assert.equal(await input.inputValue(), text);
        assert.equal(await page.locator('#narrative').textContent(), narrative); assert.equal(await page.locator('#history').textContent(), history);
        assert.equal(await page.locator('#inventory').textContent(), inventory); assert.equal(await page.locator('#player-status').textContent(), status);
      }
      for (const entry of ['prototype', 'character']) {
        const response = await page.goto(origin); assert.equal(await response.text(), fs.readFileSync('dist/index.html', 'utf8'));
        if (entry === 'prototype') await page.locator('#enter').click();
        else {
          await page.locator('#new-game').click(); await page.locator('#character-name').fill('自由行动者');
          await page.locator('#preview-character').click(); await page.locator('#start-character').click();
        }
        minutes = 0; await clock(); assert.equal(await page.evaluate(() => document.activeElement.id), 'action');
        assert.doesNotMatch(await page.locator('body').textContent(), /空罐/);
        await refuse('检查一下这个空罐'); await refuse('把这个空罐捡起来');
        await shot(`${entry}-undiscovered`); run.steps.push(`${entry}: intentional entry, hidden target refusal and unchanged draft/world projections.`);
        await success(entry === 'prototype' ? '观察一下四周' : '我观察一下周围');
        await success(entry === 'prototype' ? '透过门缝看一下' : '我透过门缝看一下');
        assert.match(await page.locator('#narrative').textContent(), /透过门缝观察/);
        await success(entry === 'prototype' ? '搜索一下房间' : '请搜索一下这个房间');
        assert.match(await page.locator('#narrative').textContent(), /发现空罐/);
        await success(entry === 'prototype' ? '检查一下这个空罐' : '请检查一下空罐');
        assert.equal(await page.locator('#inspect-targets button').count(), 1);
        await shot(`${entry}-discovered`); run.steps.push(`${entry}: novel observe, door, search and inspect use production bootstrap; clocks1..4.`);
        await success(entry === 'prototype' ? '走到相邻的走廊' : '请前往走廊');
        assert.equal(await page.locator('#current-location').textContent(), '当前位置：废弃居民楼 · 走廊');
        for (const text of ['请检查一下空罐', '把这个空罐捡起来', '透过门缝看一下', '搜索一下房间']) await refuse(text);
        await shot(`${entry}-departed`); run.steps.push(`${entry}: move and four stale-target refusals preserve time5 and last narrative.`);
        await success('我前往相邻的房间'); await success('请仔细检查一下这个空罐');
        await page.locator('#inventory summary').click(); await page.locator('#player-status summary').click();
        await success(entry === 'prototype' ? '把这个空罐捡起来' : '我把空罐拿起来');
        assert.equal(await page.locator('#inventory-list li').textContent(), '空罐 · 数量 1 · 0.05 kg');
        assert.equal(await page.locator('[data-stat="carryWeightKg"] .status-value').textContent(), '0.05 kg');
        assert.equal(await page.locator('#pickup').isVisible(), false);
        assert.equal(await page.locator('#inspect-targets button').count(), 0);
        await refuse('我把空罐拿起来'); await refuse('检查一下这个空罐');
        await shot(`${entry}-owned`); run.steps.push(`${entry}: return, composed inspect, real pickup once,0.05kg; owned target refuses reuse.`);
        await success('请搜查一下这个房间'); assert.match(await page.locator('#narrative').textContent(), /没有新发现/);
        await success('请走到这个走廊'); await success('我走到相邻的房间');
        await success('请透过这个门缝观察一下'); await success('请观察一下周围');
        await success('我观察一下四周', 'double'); assert.equal(await page.locator('#history li').count(), 3);
        await input.fill('请观察一下四周');
        for (const event of [{ key: 'Enter', ctrlKey: true, isComposing: true }, { key: 'Enter', ctrlKey: true, keyCode: 229 }]) await input.dispatchEvent('keydown', event);
        await clock(); assert.equal(await input.inputValue(), '请观察一下四周');
        await success('请观察一下四周');
        run.steps.push(`${entry}: alternate combinations, repeat search/round trip, one double-click action and IME suppression; clocks9..15, inventory remains singular.`);
        for (const text of ['不要搜索一下这个房间', '我准备走到相邻的走廊', '我想搜索一下房间', '如果安全就搜索一下房间',
          '搜索一下房间？', '“搜索一下房间”', '搜索一下房间然后拿起空罐', '搜索一下房间\n拿起空罐',
          '悄悄走到走廊', '不耗时搜索房间', '检查空罐三次', '用撬棍搜索房间', '把两个空罐拿起来',
          '把饥饿设成0', '走到prototype-corridor', '请'.repeat(20_000) + '搜索房间', '<script>搜索一下房间</script>']) await refuse(text);
        await shot(`${entry}-rejected`); run.steps.push(`${entry}:17 refusal families preserve draft, clock15, narrative/history, inventory/status including long input.`);
        await success('请原地观察');
        assert.equal(await page.locator('#inventory-list li').count(), 1);
        assert.match(await page.locator('.unsaved').first().textContent(), /未保存|刷新/);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        for (const selector of ['#narrative', '#inventory summary', '#action', '#submit', '#feedback']) {
          await page.locator(selector).scrollIntoViewIfNeeded(); const box = await page.locator(selector).boundingBox();
          assert.ok(box.x >= 0 && box.x + box.width <= viewport.width + 1 && box.y < viewport.height && box.y + box.height > 0);
        }
        await shot(`${entry}-recovered`); run.steps.push(`${entry}: recovery at16, permanent free input, truthful unsaved warning and responsive access without horizontal overflow.`);
      }
      assert.deepEqual(run.errors, []); assert.ok(run.requests.every(url => url.startsWith(origin)));
      run.status = 'passed'; await context.close();
    }
    evidence.status = 'passed';
  } catch (error) { evidence.status = 'failed'; evidence.failure = error.stack; throw error; }
  finally { fs.writeFileSync(path.join(dir, 'browser-results.json'), JSON.stringify(evidence, null, 2) + '\n'); await browser.close(); }
  console.log(JSON.stringify({ status: evidence.status, runs: evidence.runs.map(r => ({ viewport: r.viewport, groups: r.steps.length, screenshots: r.screenshots.length })) }));
})().catch(error => { console.error(error); process.exitCode = 1; });
