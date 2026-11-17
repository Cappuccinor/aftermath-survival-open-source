// Public new-character entry only; all changes go through ordinary UI actions.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const assert = require('node:assert/strict'), crypto = require('node:crypto');
const origin = 'http://127.0.0.1:4173';
const dir = path.resolve(process.argv[2] || '.superpowers/browser-g1-demo');
fs.mkdirSync(dir, { recursive: true });
const filesIn = root => fs.readdirSync(root, { recursive: true }).filter(f => fs.statSync(path.join(root, f)).isFile()).map(f => `${root}/${f.replaceAll('\\', '/')}`);
const git = (...args) => cp.execFileSync('git', args, { encoding: 'utf8' }).trim();
const sources = [...filesIn('src'), ...filesIn('scripts'), 'index.html', 'package.json', 'package-lock.json'];
const hashes = git('hash-object', '--', ...sources).split(/\r?\n/);
const evidence = {
  taskId: 'G1-018', status: 'running', observedAt: new Date().toISOString(), sourceHead: git('rev-parse', 'HEAD'),
  sourceWorktreeDirty: git('diff', '--name-only', 'HEAD').split(/\r?\n/).filter(Boolean), platform: process.platform, node: process.version, origin,
  sourceFiles: sources.map((file, i) => ({ file, gitBlob: hashes[i] })),
  artifacts: filesIn('dist').map(file => ({ file: file.slice(5), bytes: fs.statSync(file).size, sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') })), runs: [],
};
const expectedInventory = ['空罐 · 数量 1 · 0.05 kg', '瓶装水 · 数量 1 · 0.5 kg'];
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  evidence.browser = browser.version();
  try {
    for (const viewport of [{ width: 360, height: 800 }, { width: 1280, height: 900 }]) {
      const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
      const page = await context.newPage(); page.setDefaultTimeout(5000);
      const run = { viewport, status: 'running', steps: [], screenshots: [], errors: [], requests: [] };
      evidence.runs.push(run);
      page.on('pageerror', e => run.errors.push(e.message)); page.on('request', r => run.requests.push(r.url()));
      let minutes = 0;
      const input = page.locator('#action');
      async function clock() {
        await page.waitForFunction(t => document.querySelector('#clock').textContent.includes(t), `08:${String(minutes).padStart(2, '0')}`);
      }
      async function shot(name) {
        const file = `${viewport.width}-${name}.png`;
        await page.screenshot({ path: path.join(dir, file), fullPage: true }); run.screenshots.push(file);
      }
      async function visible() {
        return { clock: await page.locator('#clock').textContent(), inventory: await page.locator('#inventory-list li').allTextContents(),
          weight: await page.locator('[data-stat="carryWeightKg"] .status-value').textContent(), history: await page.locator('#history').textContent() };
      }
      async function action(kind, value) {
        if (kind === 'button') await page.getByRole('button', { name: value, exact: true }).click();
        else { await input.fill(value); await input.press('Control+Enter'); }
        minutes++; await clock();
        assert.equal(await page.locator('#feedback').getAttribute('data-phase'), 'success');
        assert.match(await page.locator('#feedback').textContent(), /尚未保存/);
        assert.equal(await input.isEditable(), true);
        if (minutes >= 7) {
          assert.deepEqual(await page.locator('#inventory-list li').allTextContents(), expectedInventory);
          assert.equal(await page.locator('[data-stat="carryWeightKg"] .status-value').textContent(), '0.55 kg');
          assert.equal(await page.getByRole('button', { name: /^拾取/ }).count(), 0);
        }
        run.steps.push({ number: minutes, kind, value, ...(await visible()), narrative: await page.locator('#narrative').textContent() });
      }
      const response = await page.goto(origin);
      assert.equal(await response.text(), fs.readFileSync('dist/index.html', 'utf8'));
      await page.locator('#new-game').click(); await page.locator('#character-name').fill('楼中幸存者');
      await page.locator('#character-importantItems').fill('家人的旧照片');
      await page.locator('#preview-character').click(); await page.locator('#start-character').click();
      await clock();
      await page.locator('#inventory summary').click(); await page.locator('#player-status summary').click();
      assert.deepEqual(await page.locator('#inventory-list li').allTextContents(), []);
      await shot('start');
      const actions = [
        ['button', '观察门缝'], ['text', '透过门缝观察'], ['button', '搜索房间'], ['text', '检查空罐'],
        ['button', '搜索柜子'], ['button', '拾取空罐'], ['text', '请把这个瓶装水拿起来'],
        ['text', '搜索柜子'], ['text', '请搜索一下房间'], ['text', '前往走廊'],
        ['text', '观察周围'], ['text', '请观察一下四周'], ['text', '前往房间'],
        ['button', '观察门缝'], ['text', '透过门缝观察'], ['button', '搜索房间'], ['text', '搜索柜子'],
        ['text', '前往走廊'], ['text', '观察周围'], ['text', '前往房间'],
        ['text', '搜索柜子'], ['text', '搜索房间'], ['text', '透过门缝观察'], ['text', '请观察一下四周'],
      ];
      for (const [kind, value] of actions) {
        if (minutes === 23) {
          const before = await visible(); const phrase = '我精准击杀他';
          await input.fill(phrase); await input.press('Control+Enter');
          await page.waitForFunction(() => document.querySelector('#feedback').dataset.phase === 'error');
          assert.deepEqual(await visible(), before); assert.equal(await input.inputValue(), phrase);
          assert.equal(await page.locator('#feedback').textContent(), '已识别为攻击意图，但当前尚未实现攻击。本次没有行动。输入已保留，可修改后重试。');
          run.refusal = { phrase, before, after: await visible(), draft: await input.inputValue(), feedback: await page.locator('#feedback').textContent() };
          await shot('refusal');
        }
        await action(kind, value);
        if (value === '搜索柜子' && minutes > 7) assert.match(await page.locator('#narrative').textContent(), /已取出/);
      }
      assert.equal(minutes, 24); await clock();
      assert.deepEqual(await page.locator('#inventory-list li').allTextContents(), expectedInventory);
      assert.equal(await page.locator('[data-stat="carryWeightKg"] .status-value').textContent(), '0.55 kg');
      assert.equal(await input.inputValue(), ''); assert.equal(await input.isEditable(), true);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      for (const selector of ['#narrative', '#action', '#submit', '#feedback']) {
        await page.locator(selector).scrollIntoViewIfNeeded(); const b = await page.locator(selector).boundingBox();
        assert.ok(b.x >= 0 && b.x + b.width <= viewport.width + 1);
      }
      assert.deepEqual(run.errors, []); assert.ok(run.requests.every(url => url.startsWith(origin)));
      run.final = await visible(); await shot('end'); run.status = 'passed'; await context.close();
    }
    evidence.status = 'passed';
  } catch (error) { evidence.status = 'failed'; evidence.failure = error.stack; throw error; }
  finally { fs.writeFileSync(path.join(dir, 'browser-results.json'), JSON.stringify(evidence, null, 2) + '\n'); await browser.close(); }
  console.log(JSON.stringify({ status: evidence.status, runs: evidence.runs.map(r => ({ viewport: r.viewport, legalActions: r.steps.length, screenshots: r.screenshots.length })) }));
})().catch(error => { console.error(error); process.exitCode = 1; });
