const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
(async () => {
  const dir = path.resolve(process.argv[2] || '.superpowers/sdd/2026-10-26-g2-010/native'); fs.mkdirSync(dir, { recursive: true });
  const { build } = await import('vite');
  await build({ configFile: false, build: { outDir: dir, emptyOutDir: false, lib: { entry: 'src/tests/browser/migration-storage-harness.ts', formats: ['es'], fileName: () => 'harness.js' } } });
  const server = http.createServer((req, res) => { res.setHeader('Content-Type', req.url === '/harness.js' ? 'text/javascript' : 'text/html'); res.end(req.url === '/harness.js' ? fs.readFileSync(path.join(dir, 'harness.js')) : '<!doctype html><title>Migration checks</title>'); });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); let browser;
  const result = { status: 'running', kind: 'Actual native IndexedDB migration and injected transaction faults; not physical power loss' };
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true }); result.browser = browser.version();
    const context = await browser.newContext(), page = await context.newPage(); await page.goto('http://127.0.0.1:' + server.address().port);
    const text = fs.readFileSync('src/tests/save-fixtures/v1.json', 'utf8'); result.checks = await page.evaluate(async text => (await import('/harness.js')).runMigrationChecks(text), text);
    const peer = await context.newPage(); await peer.goto(page.url());
    for (const same of [true, false]) {
      const name = 'g2-010-page-race-' + same;
      await page.evaluate(async d => (await import('/harness.js')).seedMigrationRace(d.name, d.text), { name, text });
      await Promise.all([page, peer].map((p, i) => p.evaluate(async d => (await import('/harness.js')).prepareMigrationRace(d.name, d.slot), { name, slot: same ? 'manual-1' : i ? 'manual-2' : 'manual-1' })));
      const results = await Promise.all([page, peer].map(p => p.evaluate(async () => (await import('/harness.js')).commitMigrationRace())));
      if (results.filter(r => r.ok).length !== (same ? 1 : 2)) throw Error('two-page CAS race');
      result.checks.push(same ? 'two actual pages: exactly one same-slot migration' : 'two actual pages: independent slots both migrate');
    }
    result.status = 'passed';
  } catch (error) { result.status = 'failed'; result.error = String(error); throw error; }
  finally { fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2) + '\n'); await browser?.close(); await new Promise(r => server.close(r)); }
  console.log(JSON.stringify(result));
})().catch(error => { console.error(error); process.exitCode = 1; });
