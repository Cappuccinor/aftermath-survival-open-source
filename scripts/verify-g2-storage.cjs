const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
(async () => {
  const { build } = await import('vite');
  const folder = path.resolve('.superpowers/sdd/2026-10-24-g2-001/storage-browser');
  fs.mkdirSync(folder, { recursive: true });
  await build({ configFile: false, build: { outDir: folder, emptyOutDir: false, lib: { entry: 'src/tests/browser/storage-harness.ts', formats: ['es'], fileName: () => 'harness.js' } } });
  const server = http.createServer((req, res) => { if (req.url === '/harness.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(path.join(folder, 'harness.js'))); } else res.end('<!doctype html><title>Isolated storage verification</title>'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true }); const context = await browser.newContext();
    const base = `http://127.0.0.1:${server.address().port}`;
    const page = await context.newPage(); await page.goto(base);
    const checks = await page.evaluate(async () => (await import('/harness.js')).runStorageChecks('g2-test'));
    const page2 = await context.newPage(); await page2.goto(base);
    const tokens = await Promise.all([page, page2].map(p => p.evaluate(async () => (await import('/harness.js')).prepareRace('g2-race'))));
    assert.deepEqual(tokens, [null, null]);
    const race = await Promise.all([page, page2].map(p => p.evaluate(async () => (await import('/harness.js')).writeRace())));
    assert.equal(race.filter(r => r.ok).length, 1); assert.equal(race.filter(r => !r.ok && r.code === 'conflict').length, 1);
    checks.push('two independent browser pages: one CAS commit, one conflict');
    const result = { checks, browser: browser.version(), passed: true, kind: 'actual IndexedDB, fault injection and page concurrency; not physical power loss' };
    fs.writeFileSync(path.join(folder, 'result.json'), JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(result));
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
