// Real dist / bootstrap, no injected game or interpreter. Build + preview4173 first.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const assert = require('node:assert/strict'), crypto = require('node:crypto');
const origin = 'http://127.0.0.1:4173', dir = path.resolve(process.argv[2] || '.superpowers/browser-water');
fs.mkdirSync(dir, { recursive: true });
const filesIn = root => fs.readdirSync(root, { recursive: true }).filter(f => fs.statSync(path.join(root, f)).isFile()).map(f => `${root}/${f.replaceAll('\\', '/')}`);
const sources = [...filesIn('src'), ...filesIn('scripts'), 'index.html', 'package.json', 'package-lock.json'];
const git = (...args) => cp.execFileSync('git', args, { encoding: 'utf8' }).trim();
const hashes = git('hash-object', '--', ...sources).split(/\r?\n/);
const evidence = { taskId: 'G1-015', status: 'running', observedAt: new Date().toISOString(), sourceHead: git('rev-parse', 'HEAD'),
  sourceWorktreeDirty: git('diff', '--name-only', 'HEAD').split(/\r?\n/).filter(Boolean), platform: process.platform, node: process.version, origin,
  sourceFiles: sources.map((file, i) => ({ file, gitBlob: hashes[i] })),
  artifacts: filesIn('dist').map(file => ({ file: file.slice(5), bytes: fs.statSync(file).size, sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') })), runs: [] };
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true }); evidence.browser = browser.version();
  try {
    for (const viewport of [{ width: 1280, height: 900 }, { width: 360, height: 800 }]) {
      const context = await browser.newContext({ viewport, deviceScaleFactor: 1 }), page = await context.newPage(); page.setDefaultTimeout(5000);
      const run = { viewport, steps: [], screenshots: [], errors: [], requests: [] }; evidence.runs.push(run);
      page.on('pageerror', e => run.errors.push(e.message)); page.on('request', r => run.requests.push(r.url()));
      const input = page.locator('#action'), cabinet = page.getByRole('button', { name: '搜索柜子', exact: true }); let minutes = 0;
      const pickup = label => page.getByRole('button', { name: `拾取${label}`, exact: true });
      async function clock() { await page.waitForFunction(t => document.querySelector('#clock').textContent.includes(t), `08:${String(minutes).padStart(2,'0')}`); }
      async function shot(name) { const file = `${viewport.width}-${name}.png`; await page.screenshot({ path: path.join(dir,file), fullPage:true }); run.screenshots.push(file); }
      async function act(text) { await input.fill(text); await input.press('Control+Enter'); minutes++; await clock(); assert.equal(await page.locator('#feedback').getAttribute('data-phase'), 'success'); }
      async function click(button) { await button.click(); minutes++; await clock(); }
      async function refuse(text) {
        const before = await page.locator('#history').textContent(), inventory = await page.locator('#inventory').textContent();
        await input.fill(text); await input.press('Control+Enter'); await page.waitForFunction(() => document.querySelector('#feedback').dataset.phase === 'error');
        await clock(); assert.equal(await input.inputValue(),text); assert.equal(await page.locator('#history').textContent(),before); assert.equal(await page.locator('#inventory').textContent(),inventory);
      }
      for (const entry of ['prototype','character']) for (const first of ['空罐','瓶装水']) {
        const second = first === '空罐' ? '瓶装水' : '空罐', prefix = `${entry}-${first === '空罐' ? 'tin-first' : 'water-first'}`;
        const response = await page.goto(origin); assert.equal(await response.text(), fs.readFileSync('dist/index.html','utf8'));
        if (entry === 'prototype') await page.locator('#enter').click();
        else { await page.locator('#new-game').click(); await page.locator('#character-name').fill('取水的幸存者'); await page.locator('#preview-character').click(); await page.locator('#start-character').click(); }
        minutes = 0; await clock(); assert.doesNotMatch(await page.locator('#experience').innerHTML(), /瓶装水|bottled-water|sealed/);
        assert.equal(await page.locator('#inventory-list li').count(),0); await refuse('拿起瓶装水');
        assert.doesNotMatch(await page.locator('#experience').innerHTML(), /prototype-bottled-water|sealed/);
        run.steps.push(`${prefix}: undiscovered bottle absent from visible/hidden DOM; fabricated target text refuses.`);
        // Exercise both first-bound primary identities; all four paths then allow either pickup choice.
        if (first === '空罐') { await click(page.locator('#search')); await click(cabinet); }
        else { await act('请搜索一下这个柜子'); await click(page.locator('#search')); }
        assert.equal(await pickup('空罐').count(),1); assert.equal(await pickup('瓶装水').count(),1);
        assert.equal(await page.locator('#inventory-list li').count(),0);
        const primaryId = await page.locator('#pickup').getAttribute('data-target-id');
        await page.locator('#inventory summary').click(); await page.locator('#player-status summary').click();
        await shot(`${prefix}-both-available`); run.steps.push(`${prefix}: two distinct suggestions, discovery does not give ownership.`);
        const target = pickup(first); await target.scrollIntoViewIfNeeded();
        await target.dblclick({delay:40}); minutes++; await clock();
        assert.equal(await page.locator('#inventory-list li').count(),1);
        assert.equal(await page.locator('#pickup').getAttribute('data-target-id'),primaryId);
        assert.equal(await page.locator('#pickup').isVisible(),false); assert.equal(await pickup(second).count(),1);
        assert.equal(await input.evaluate(el => el === document.activeElement),true);
        const expectedWeight = first === '空罐' ? '0.05 kg' : '0.5 kg';
        assert.equal(await page.locator('[data-stat="carryWeightKg"] .status-value').textContent(),expectedWeight);
        assert.equal(await page.locator('#inventory-list li').textContent(),`${first} · 数量 1 · ${expectedWeight}`);
        await shot(`${prefix}-one-owned`); run.steps.push(`${prefix}: physical double click transfers one item only, primary identity retained, second still selectable, focus in free input.`);
        await act('搜索柜子'); assert.match(await page.locator('#narrative').textContent(),first === '瓶装水' ? /已取出/ : /仍在柜中/);
        // Activate the additional stable node by held keyboard, or use the existing complete grammar.
        if (entry === 'prototype') {
          const extra = pickup(second); await extra.focus(); await page.keyboard.down('Enter'); minutes++; await clock();
          await page.keyboard.down('Enter'); await page.keyboard.up('Enter');
          await input.dispatchEvent('keydown',{key:' ',code:'Space',repeat:true,bubbles:true}); await input.dispatchEvent('keyup',{key:' ',code:'Space',bubbles:true});
          assert.equal(await input.inputValue(),''); assert.equal(await input.evaluate(el => el === document.activeElement),true); await clock();
        } else await act(second === '瓶装水' ? '请把这个瓶装水拿起来' : '拿起空罐');
        assert.equal(await page.locator('#inventory-list li').count(),2); assert.equal(await pickup('空罐').count(),0); assert.equal(await pickup('瓶装水').count(),0);
        assert.equal(await page.locator('[data-stat="carryWeightKg"] .status-value').textContent(),'0.55 kg');
        assert.deepEqual(await page.locator('#inventory-list li').allTextContents(),['空罐 · 数量 1 · 0.05 kg','瓶装水 · 数量 1 · 0.5 kg']);
        run.steps.push(`${prefix}: second item via held Enter or full free sentence; exact two entries/load0.55kg, no repeated command.`);
        await act('搜索柜子'); assert.match(await page.locator('#narrative').textContent(),/没有新发现.*已取出/);
        const move = page.locator('#move-targets button'); await move.dblclick({delay:40}); minutes++; await clock(); assert.equal(await move.evaluate(el => el === document.activeElement),true);
        assert.equal(await page.locator('#inventory-list li').count(),2); await refuse('搜索柜子');
        await act('前往房间'); await act('搜索柜子'); assert.match(await page.locator('#narrative').textContent(),/没有新发现.*已取出/);
        assert.equal(await page.locator('#inventory-list li').count(),2); run.steps.push(`${prefix}: repeat searches and round trip retain ownership and empty pickup suggestions, no regeneration.`);
        for (const phrase of ['拿起瓶装水','拾取空罐','喝瓶装水','检查瓶装水','丢弃瓶装水','交易瓶装水','拿起瓶装水并喝水','再给我一瓶水']) await refuse(phrase);
        await act('请观察一下四周'); assert.match(await page.locator('#feedback').textContent(),/尚未保存/); assert.equal(await input.isEditable(),true);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth));
        for (const selector of ['#narrative','#action','#submit','#feedback']) { await page.locator(selector).scrollIntoViewIfNeeded(); const b = await page.locator(selector).boundingBox(); assert.ok(b.x>=0&&b.x+b.width<=viewport.width+1); }
        await shot(`${prefix}-recovered`); run.steps.push(`${prefix}: eight unsupported/duplicate inputs retain draft/time/inventory, legal recovery with free input and no horizontal overflow.`);
      }
      assert.deepEqual(run.errors,[]); assert.ok(run.requests.every(url=>url.startsWith(origin))); run.status='passed'; await context.close();
    }
    evidence.status='passed';
  } catch(error) { evidence.status='failed'; evidence.failure=error.stack; throw error; }
  finally { fs.writeFileSync(path.join(dir,'browser-results.json'),JSON.stringify(evidence,null,2)+'\n'); await browser.close(); }
  console.log(JSON.stringify({status:evidence.status,runs:evidence.runs.map(r=>({viewport:r.viewport,groups:r.steps.length,screenshots:r.screenshots.length}))}));
})().catch(error=>{console.error(error);process.exitCode=1;});
