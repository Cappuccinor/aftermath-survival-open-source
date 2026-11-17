// Build and preview on port 4173. No injected interpreter or production debug hook.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const assert = require('node:assert/strict'), crypto = require('node:crypto');
const origin = 'http://127.0.0.1:4173', dir = path.resolve(process.argv[2] || '.superpowers/browser-unsupported-intent');
fs.mkdirSync(dir, { recursive: true });
const filesIn = root => fs.readdirSync(root, { recursive: true }).filter(f => fs.statSync(path.join(root, f)).isFile()).map(f => `${root}/${f.replaceAll('\\', '/')}`);
const sources = [...filesIn('src'), ...filesIn('scripts'), 'index.html', 'package.json', 'package-lock.json'];
const git = (...args) => cp.execFileSync('git', args, { encoding: 'utf8' }).trim();
const hashes = git('hash-object', '--', ...sources).split(/\r?\n/);
const evidence = { taskId: 'G1-013', status: 'running', observedAt: new Date().toISOString(), sourceHead: git('rev-parse', 'HEAD'),
  sourceWorktreeDirty: git('diff', '--name-only', 'HEAD').split(/\r?\n/).filter(Boolean), platform: process.platform, node: process.version, origin,
  sourceFiles: sources.map((file, i) => ({ file, gitBlob: hashes[i] })),
  artifacts: filesIn('dist').map(file => ({ file: file.slice(5), bytes: fs.statSync(file).size, sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') })), runs: [] };
const feedback = '已识别为攻击意图，但当前尚未实现攻击。本次没有行动。输入已保留，可修改后重试。';
const declarations = ['我精准击杀他', '我杀了他', '我要杀死他', '我要杀死NPC', '攻击他', '我攻击他', '攻击NPC'];
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true }); evidence.browser = browser.version();
  try {
    for (const viewport of [{ width: 1280, height: 900 }, { width: 360, height: 800 }]) {
      const context = await browser.newContext({ viewport, deviceScaleFactor: 1 }), page = await context.newPage();
      page.setDefaultTimeout(5000);
      const run = { viewport, steps: [], screenshots: [], errors: [], requests: [] }; evidence.runs.push(run);
      page.on('pageerror', error => run.errors.push(error.message)); page.on('request', request => run.requests.push(request.url()));
      const input = page.locator('#action'); let minutes = 0;
      async function clock() { await page.waitForFunction(t => document.querySelector('#clock').textContent.includes(t), `08:${String(minutes).padStart(2, '0')}`); }
      async function projections() {
        return page.evaluate(() => Object.fromEntries(['#clock', '#current-location', '#scene-context', '#narrative', '#history', '#inventory', '#player-status', '#inspect-targets', '#move-targets']
          .map(selector => [selector, document.querySelector(selector)?.textContent ?? null])));
      }
      async function shot(name) {
        const file = `${viewport.width}-${name}.png`; await page.screenshot({ path: path.join(dir, file), fullPage: true }); run.screenshots.push(file);
      }
      async function classify(text, recognized = true) {
        const before = await projections(); await input.fill(text); await input.press('Control+Enter');
        await page.waitForFunction(() => document.querySelector('#feedback').dataset.phase === 'error');
        assert.deepEqual(await projections(), before); await clock(); assert.equal(await input.inputValue(), text);
        const message = await page.locator('#feedback').textContent();
        if (recognized) assert.equal(message, feedback);
        else { assert.notEqual(message, feedback); assert.match(message, /没有行动/); }
        assert.equal(await page.evaluate(() => document.activeElement.id), 'action');
        assert.doesNotMatch(message, /prototype|created-player|警觉|击杀成功|击杀失败|目标不存在/);
      }
      async function act(text) {
        await input.fill(text); await input.press('Control+Enter'); minutes++; await clock();
        assert.equal(await page.locator('#feedback').getAttribute('data-phase'), 'success');
        assert.equal(await input.inputValue(), ''); assert.match(await page.locator('#feedback').textContent(), /尚未保存/);
      }
      for (const entry of ['prototype', 'character']) {
        const response = await page.goto(origin); assert.equal(await response.text(), fs.readFileSync('dist/index.html', 'utf8'));
        if (entry === 'prototype') await page.locator('#enter').click();
        else { await page.locator('#new-game').click(); await page.locator('#character-name').fill('保留决定的人'); await page.locator('#preview-character').click(); await page.locator('#start-character').click(); }
        minutes = 0; await clock();
        for (const text of declarations) await classify(text);
        assert.equal(await page.locator('#history li').count(), 0);
        await shot(`${entry}-initial-unsupported`); run.steps.push(`${entry}: all7 complete attack statements at time0, precise unsupported/non-execution feedback, retained draft/focus and zero history/projection change.`);
        for (const text of ['不要攻击他', '我准备攻击他', '我想攻击他', '如果安全就攻击他', '攻击他？', '“攻击他”',
          '攻击他然后拿起空罐', '观察四周然后攻击他', '攻击他\n拿起空罐', '<b>攻击他</b>', '我准备离开']) await classify(text, false);
        run.steps.push(`${entry}:11 negation/preparation/wish/condition/question/quote/compound/newline/HTML/legacy-leave probes remain ordinary refusal, no partial classification.`);
        for (const text of ['请搜索一下这个房间', '我透过门缝看一下', '把这个空罐捡起来', '走到相邻的走廊']) {
          await act(text);
          for (const declaration of ['我杀了他', '我精准击杀他', '我要杀死NPC']) await classify(declaration);
        }
        assert.equal(await page.locator('#inventory-list li').textContent(), '空罐 · 数量 1 · 0.05 kg');
        assert.equal(await page.locator('[data-stat="carryWeightKg"] .status-value').textContent(), '0.05 kg');
        assert.equal(await page.locator('#current-location').textContent(), '当前位置：废弃居民楼 · 走廊');
        assert.equal(await page.locator('#history li').count(), 3);
        for (const text of declarations) await classify(text);
        await page.locator('#inventory summary').click();
        await shot(`${entry}-owned-unsupported`); run.steps.push(`${entry}: search/door/pickup/move each recover, then category feedback preserves all actual projections/history; time4, one tin0.05kg, corridor.`);
        await act('请前往房间'); await act('请观察一下四周');
        assert.equal(await page.locator('#inventory-list li').count(), 1);
        assert.match(await page.locator('.unsaved').first().textContent(), /未保存|刷新/);
        assert.ok(!(await page.locator('button').allTextContents()).some(text => /攻击|击杀/.test(text)));
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        for (const selector of ['#narrative', '#inventory summary', '#action', '#submit', '#feedback']) {
          await page.locator(selector).scrollIntoViewIfNeeded(); const box = await page.locator(selector).boundingBox();
          assert.ok(box.x >= 0 && box.x + box.width <= viewport.width + 1 && box.y < viewport.height && box.y + box.height > 0);
        }
        await shot(`${entry}-recovered`); run.steps.push(`${entry}: real recovery to time6, permanent free input and unsaved feedback, no attack button or horizontal overflow.`);
      }
      assert.deepEqual(run.errors, []); assert.ok(run.requests.every(url => url.startsWith(origin)));
      run.status = 'passed'; await context.close();
    }
    evidence.status = 'passed';
  } catch (error) { evidence.status = 'failed'; evidence.failure = error.stack; throw error; }
  finally { fs.writeFileSync(path.join(dir, 'browser-results.json'), JSON.stringify(evidence, null, 2) + '\n'); await browser.close(); }
  console.log(JSON.stringify({ status: evidence.status, runs: evidence.runs.map(r => ({ viewport: r.viewport, groups: r.steps.length, screenshots: r.screenshots.length })) }));
})().catch(error => { console.error(error); process.exitCode = 1; });
