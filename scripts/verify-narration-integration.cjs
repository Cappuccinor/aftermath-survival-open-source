// Compile actual modules into a separate local test bundle; this is NOT the production dist or a real model.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const output = path.resolve(process.argv[2] || '.superpowers/narration-integration');
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const report = { taskId: 'G1-011', scope: 'isolated trusted composition → real game/session/render; local Narrator doubles, no external model',
  observedAt: new Date().toISOString(), status: 'running', runs: [] };
fs.mkdirSync(output, { recursive: true });
(async () => {
  const { build } = await import('vite');
  const result = await build({ configFile: false, logLevel: 'error', build: { write: false, minify: false,
    lib: { entry: path.resolve('scripts/narration-integration-entry.ts'), name: 'NarrationHarness', formats: ['iife'], fileName: () => 'isolated-harness.js' } } });
  const bundle = (Array.isArray(result) ? result[0] : result).output.find(item => item.type === 'chunk').code;
  fs.writeFileSync(path.join(output, 'isolated-harness.js'), bundle);
  const html = fs.readFileSync('index.html', 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace('<link rel="stylesheet" href="/src/ui/style.css" />', () => `<style>${fs.readFileSync('src/ui/style.css', 'utf8')}</style>`)
    .replace(/[\t ]+$/gm, '');
  fs.writeFileSync(path.join(output, 'isolated-host.html'), html);
  report.artifacts = [{ file: 'isolated-harness.js', sha256: hash(bundle) }, { file: 'isolated-host.html', sha256: hash(html) }];
  const sources = [...fs.readdirSync('src', { recursive: true }).filter(p => fs.statSync(path.join('src', p)).isFile()).map(p => 'src/' + p.replaceAll('\\', '/')),
    'index.html', 'package.json', 'package-lock.json', 'scripts/narration-integration-entry.ts', 'scripts/verify-narration-integration.cjs'];
  report.sourceHead = cp.execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  report.sourceFiles = sources.map(file => ({ file, gitBlob: cp.execFileSync('git', ['hash-object', '--', file], { encoding: 'utf8' }).trim() }));
  const browser = await chromium.launch({ channel: 'chrome', headless: true }); report.browser = browser.version();
  try {
    for (const viewport of [{ width: 1280, height: 900 }, { width: 360, height: 800 }]) {
      const context = await browser.newContext({ viewport }); const page = await context.newPage();
      const errors = [], requests = [], run = { viewport, steps: [], screenshots: [], errors, requests };
      report.runs.push(run); page.on('pageerror', e => errors.push(e.message)); page.on('request', r => requests.push(r.url()));
      async function install(short = false) {
        await page.setContent(html); await page.addScriptTag({ content: bundle });
        assert.equal(await page.evaluate(() => document.styleSheets.length), 1, 'isolated host must include actual UI CSS');
        await page.evaluate(short => { window.harness = window.NarrationHarness.install(short); }, short);
        await page.locator('#enter').click();
      }
      const read = () => page.evaluate(() => window.harness.read());
      const mode = next => page.evaluate(next => window.harness.setMode(next), next);
      async function settled(revision) {
        await page.waitForFunction(revision => window.harness.read().view.phase === 'success' && window.harness.read().view.clock.worldRevision === revision, revision);
        const state = await read(); assert.equal(state.view.canRetry, false); assert.match(state.view.message, /尚未保存/);
        assert.equal(await page.locator('#narrative').textContent(), state.view.entries.at(-1).summary);
        assert.doesNotMatch(await page.locator('#experience').textContent(), /十把枪|新NPC|无条件服从/);
        assert.ok(await page.locator('#action').isEditable()); return state;
      }
      async function shot(name) { const file = `${viewport.width}-${name}.png`; await page.screenshot({ path: path.join(output, file), fullPage: true }); run.screenshots.push(file); }
      await install(); await page.locator('#observe').click(); let state = await settled(1);
      assert.match(state.view.entries[0].summary, /。\n光线/); run.steps.push('legal complete variant rendered through real game/session/UI'); await shot('legal');
      await mode('forged'); await page.locator('#search').click(); state = await settled(2);
      assert.equal(state.view.entries.at(-1).summary, '你花了一分钟搜索房间，发现空罐。');
      await mode('throw'); await page.locator('#pickup').click(); state = await settled(3);
      assert.equal(state.view.inventory.length, 1); assert.equal(state.view.playerStatus.carryWeightKg, .05);
      run.steps.push('forged narrative falls back; adapter failure preserves picked inventory and load');
      await mode('reject'); await page.locator('#move-targets button').click(); state = await settled(4);
      assert.equal(state.view.sceneContext.locationRole, 'corridor');
      await mode('pending'); await page.locator('#observe').click(); await settled(5);
      await mode('legal'); await page.locator('#move-targets button').click(); await settled(6);
      run.steps.push('rejection and permanent pending fall back, then legal next action succeeds'); await shot('recovered');
      for (const [offset, success] of [[0, true], [2, false]]) {
        await mode('late'); await page.locator('#observe').click(); await settled(7 + offset);
        await mode('legal'); await page.locator('#move-targets button').click(); const before = await settled(8 + offset);
        await page.evaluate(success => window.harness.settleLate(success), success);
        await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 120)));
        assert.deepEqual(await read(), before); run.steps.push(`late ${success ? 'success' : 'rejection'} cannot replace subsequent scene/history`);
      }
      assert.equal((await read()).calls, 10); await shot('late-ignored');
      await mode('cleanup-success'); await page.locator('#observe').click(); await settled(11);
      run.steps.push('ordinary cancellation cleanup throws/rejects on successful narration are contained');
      await mode('cleanup-timeout'); await page.locator('#observe').click(); await settled(12);
      await mode('legal'); await page.locator('#move-targets button').click(); await settled(13);
      run.steps.push('cleanup throws/rejects on deadline are contained; next action succeeds without host errors');
      await shot('cleanup-recovered');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      // Separate page lifecycle: action session times out before Narrator budget, then confirms same ID.
      await page.reload(); await install(true); await page.locator('#move-targets button').click();
      await page.waitForFunction(() => window.harness.read().view.canRetry);
      assert.equal((await read()).view.clock.worldRevision, 0);
      await page.locator('#retry').click(); state = await settled(1);
      assert.equal(state.calls, 1); assert.equal(state.view.entries.length, 1);
      await mode('legal'); await page.locator('#move-targets button').click(); const before = await settled(2);
      await page.evaluate(() => window.harness.settleLate(true));
      await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 120)));
      assert.deepEqual(await read(), before); assert.equal(before.view.entries.length, 2);
      run.steps.push('short session timeout → same-ID confirmation → next action; delayed old result ignored without duplicate narration');
      await shot('confirmed'); assert.deepEqual(errors, []); assert.deepEqual(requests, []);
      run.status = 'passed'; await context.close();
    }
    report.status = 'passed';
  } finally { await browser.close(); }
})().catch(error => { report.status = 'failed'; report.error = error.stack; process.exitCode = 1; }).finally(() => {
  fs.writeFileSync(path.join(output, 'integration-results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, runs: report.runs.map(r => ({ width: r.viewport.width, status: r.status, groups: r.steps.length })), error: report.error }));
});
