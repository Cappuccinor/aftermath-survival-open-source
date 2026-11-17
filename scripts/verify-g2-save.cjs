const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), crypto = require('node:crypto'), cp = require('node:child_process');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const dir = path.resolve(process.argv[2] || '.superpowers/sdd/2026-10-24-g2-001/public-browser');
fs.mkdirSync(dir, { recursive: true });
const record = { sourceHead: cp.execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  kind: 'actual production dist, IndexedDB and persistent test-profile browser close/reopen; not physical power loss', runs: [] };
const fileList = folder => fs.readdirSync(folder, { recursive: true }).filter(f => fs.statSync(path.join(folder, f)).isFile());
record.artifacts = fileList('dist').map(file => ({ file, sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join('dist', file))).digest('hex') }));
const server = http.createServer((req, res) => {
  const relative = req.url === '/' ? 'index.html' : req.url.slice(1).split('?')[0]; const file = path.resolve('dist', relative);
  if (!file.startsWith(path.resolve('dist') + path.sep) || !fs.existsSync(file)) { res.statusCode = 404; res.end(); return; }
  res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); res.end(fs.readFileSync(file));
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const viewport of [{ width: 360, height: 800 }, { width: 1280, height: 900 }]) {
      const profile = path.join(dir, `profile-${viewport.width}-${Date.now()}`), run = { viewport, steps: [], screenshots: [], errors: [] }; record.runs.push(run);
      let context, page;
      async function open() { context = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: true, viewport }); page = await context.newPage(); page.setDefaultTimeout(5000); page.on('pageerror', e => run.errors.push(e.message)); await page.goto(origin); }
      const saved = () => page.waitForFunction(() => document.querySelector('#save-status')?.getAttribute('data-phase') === 'saved');
      async function projection() { return { clock: await page.locator('#clock').textContent(), location: await page.locator('#current-location').textContent(), inventory: await page.locator('#inventory-list li').allTextContents(), weight: await page.locator('[data-stat="carryWeightKg"] .status-value').textContent(), history: await page.locator('#history').textContent(), narrative: await page.locator('#narrative').textContent(), character: await page.locator('#character-profile').textContent() }; }
      async function disk() { return page.evaluate(() => new Promise((resolve, reject) => { const r = indexedDB.open('aftermath-survival', 1); r.onerror = () => reject(r.error); r.onsuccess = () => { const db = r.result, tx = db.transaction(['heads', 'snapshots']); const h = tx.objectStore('heads').get('manual-1'); let raw; h.onsuccess = () => { const s = tx.objectStore('snapshots').get(h.result.token); s.onsuccess = () => { raw = s.result; }; }; tx.oncomplete = () => { db.close(); resolve(raw); }; tx.onabort = () => { db.close(); reject(tx.error); }; }; })); }
      async function shot(name) { const file = `${viewport.width}-${name}.png`; await page.screenshot({ path: path.join(dir, file), fullPage: true }); run.screenshots.push(file); }
      let minutes = 0;
      async function action(text) { await page.locator('#action').fill(text); await page.locator('#action').press('Control+Enter'); minutes++; await page.waitForFunction(t => document.querySelector('#clock').textContent.includes(t), `08:${String(minutes).padStart(2, '0')}`); run.steps.push(text); }
      try {
        await open(); await page.locator('#manual-load').waitFor();
        await page.locator('#new-game').click(); await page.locator('#character-name').fill('存档旅人'); await page.locator('#character-wish').fill('再次醒来时世界仍然记得');
        await page.locator('#preview-character').click(); await page.locator('#start-character').click();
        for (const text of ['观察门缝', '搜索房间', '检查空罐', '拿起空罐', '搜索柜子', '拿起瓶装水', '前往走廊', '前往房间']) await action(text);
        await page.locator('#manual-save').click(); await saved(); const before = await projection(), raw = await disk();
        assert.equal(before.weight, '0.55 kg'); assert.equal(JSON.parse(raw).worldRevision, 8); await shot('saved');
        await context.close(); context = null; await open();
        assert.equal(await page.locator('#experience').isVisible(), false);
        await page.locator('#manual-load').click(); await saved();
        assert.deepEqual(await projection(), before); assert.equal(await disk(), raw); await shot('restored');
        minutes = 8; await action('搜索柜子'); assert.match(await page.locator('#narrative').textContent(), /没有新发现/);
        assert.match(await page.locator('#save-status').textContent(), /未保存/);
        const after = await projection(); await page.locator('#action').fill('我精准击杀他'); await page.locator('#action').press('Control+Enter');
        await page.waitForFunction(() => document.querySelector('#feedback').textContent.includes('尚未实现攻击'));
        assert.deepEqual(await projection(), after); assert.equal(await page.locator('#action').inputValue(), '我精准击杀他');
        await page.locator('#manual-load').click(); await page.locator('#cancel-persistence').click();
        assert.deepEqual(await projection(), after); assert.equal(await page.locator('#action').inputValue(), '我精准击杀他');
        await page.locator('#manual-load').click(); await page.locator('#confirm-persistence').click(); await saved(); assert.deepEqual(await projection(), before);
        await page.reload(); await page.locator('#enter').click(); await page.locator('#manual-save').click();
        await page.locator('#cancel-persistence').click(); assert.equal(await disk(), raw); await shot('cancel-overwrite');
        // A bad previous snapshot must not prevent loading the valid current snapshot.
        await page.evaluate(() => new Promise((resolve, reject) => { const r = indexedDB.open('aftermath-survival', 1); r.onsuccess = () => { const db = r.result, tx = db.transaction(['heads', 'snapshots'], 'readwrite'), h = tx.objectStore('heads').get('manual-1'); h.onsuccess = () => { tx.objectStore('snapshots').put('{bad-backup', 'test-damaged-backup'); tx.objectStore('heads').put({ ...h.result, previousToken: 'test-damaged-backup' }, 'manual-1'); }; tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => { db.close(); reject(tx.error); }; }; }));
        await page.locator('#manual-load').click(); await page.locator('#confirm-persistence').click(); await saved();
        assert.deepEqual(await projection(), before); assert.equal(await disk(), raw);
        assert.match(await page.locator('#save-slot').textContent(), /上一备份损坏/); await shot('backup-warning');
        // Both pages load revision 8. B's higher revision must never replace A's different history.
        const rival = await context.newPage();
        try {
          await rival.goto(origin); await rival.locator('#manual-load').click();
          await rival.waitForFunction(() => document.querySelector('#save-status').dataset.phase === 'saved');
          minutes = 8; await action('搜索柜子'); await page.locator('#manual-save').click(); await saved();
          const committed = await disk(); assert.equal(JSON.parse(committed).worldRevision, 9);
          for (const minute of [9, 10]) {
            await rival.locator('#action').fill('观察周围'); await rival.locator('#action').press('Control+Enter');
            await rival.waitForFunction(t => document.querySelector('#clock').textContent.includes(t), `08:${String(minute).padStart(2, '0')}`);
          }
          await rival.locator('#manual-save').click();
          await rival.waitForFunction(() => document.querySelector('#save-status').dataset.phase === 'error');
          assert.match(await rival.locator('#save-status').textContent(), /其他操作更新/); assert.equal(await disk(), committed);
          const file = `${viewport.width}-stale-branch.png`; await rival.screenshot({ path: path.join(dir, file), fullPage: true }); run.screenshots.push(file);
          run.staleBranch = { committedRevision: 9, rejectedRevision: 10, unchanged: true };
        } finally { await rival.close(); }
        const protoBefore = await page.locator('#clock').textContent(); await page.locator('#action').fill('保留当前草稿');
        // Trusted test orchestration corrupts only this disposable test profile. No product hook exists.
        await page.evaluate(() => new Promise((resolve, reject) => { const r = indexedDB.open('aftermath-survival', 1); r.onsuccess = () => { const db = r.result, tx = db.transaction(['heads', 'snapshots'], 'readwrite'), h = tx.objectStore('heads').get('manual-1'); h.onsuccess = () => tx.objectStore('snapshots').put('{broken', h.result.token); tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => { db.close(); reject(tx.error); }; }; }));
        await page.locator('#manual-load').click(); await page.waitForFunction(() => document.querySelector('#save-status').getAttribute('data-phase') === 'error');
        assert.equal(await page.locator('#clock').textContent(), protoBefore); assert.equal(await page.locator('#action').inputValue(), '保留当前草稿'); assert.equal(await disk(), '{broken'); await shot('corrupt-retained');
        assert.deepEqual(run.errors, []); assert.equal(await page.locator('#action').isEditable(), true);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth); assert.equal(overflow, false);
        run.status = 'passed'; run.worldSha256 = crypto.createHash('sha256').update(raw).digest('hex'); run.finalRevision = JSON.parse(raw).worldRevision;
      } finally { await context?.close(); }
    }
    record.status = 'passed';
  } catch (error) { record.status = 'failed'; record.error = String(error); throw error; }
  finally { fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(record, null, 2) + '\n'); await new Promise(resolve => server.close(resolve)); }
  console.log(JSON.stringify({ status: record.status, runs: record.runs.map(r => ({ viewport: r.viewport, status: r.status, steps: r.steps.length, screenshots: r.screenshots.length })) }));
})().catch(error => { console.error(error); process.exitCode = 1; });
