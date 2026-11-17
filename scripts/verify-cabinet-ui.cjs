// Build and preview on port 4173. No injected interpreter or production debug hook.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const assert = require('node:assert/strict'), crypto = require('node:crypto');
const origin = 'http://127.0.0.1:4173', dir = path.resolve(process.argv[2] || '.superpowers/browser-cabinet');
fs.mkdirSync(dir, { recursive: true });
const filesIn = root => fs.readdirSync(root, { recursive: true }).filter(f => fs.statSync(path.join(root, f)).isFile()).map(f => `${root}/${f.replaceAll('\\', '/')}`);
const sources = [...filesIn('src'), ...filesIn('scripts'), 'index.html', 'package.json', 'package-lock.json'];
const git = (...args) => cp.execFileSync('git', args, { encoding: 'utf8' }).trim();
const hashes = git('hash-object', '--', ...sources).split(/\r?\n/);
const evidence = { taskId: 'G1-015-cabinet-regression', status: 'running', observedAt: new Date().toISOString(), sourceHead: git('rev-parse', 'HEAD'),
  sourceWorktreeDirty: git('diff', '--name-only', 'HEAD').split(/\r?\n/).filter(Boolean), platform: process.platform, node: process.version, origin,
  sourceFiles: sources.map((file, i) => ({ file, gitBlob: hashes[i] })),
  artifacts: filesIn('dist').map(file => ({ file: file.slice(5), bytes: fs.statSync(file).size, sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') })), runs: [] };
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true }); evidence.browser = browser.version();
  try {
    for (const viewport of [{ width: 1280, height: 900 }, { width: 360, height: 800 }]) {
      const context = await browser.newContext({ viewport, deviceScaleFactor: 1 }), page = await context.newPage();
      page.setDefaultTimeout(5000);
      const run = { viewport, steps: [], screenshots: [], errors: [], requests: [] }; evidence.runs.push(run);
      page.on('pageerror', e => run.errors.push(e.message)); page.on('request', r => run.requests.push(r.url()));
      const input = page.locator('#action'), cabinet = page.locator('#search-targets button').filter({ hasText: '搜索柜子' }); let minutes = 0;
      async function clock() { await page.waitForFunction(t => document.querySelector('#clock').textContent.includes(t), `08:${String(minutes).padStart(2,'0')}`); }
      async function shot(name) { const file = `${viewport.width}-${name}.png`; await page.screenshot({ path: path.join(dir,file), fullPage:true }); run.screenshots.push(file); }
      async function act(text) { await input.fill(text); await input.press('Control+Enter'); minutes++; await clock(); assert.equal(await page.locator('#feedback').getAttribute('data-phase'), 'success'); }
      async function refuse(text) {
        const before = await page.locator('#history').textContent(); await input.fill(text); await input.press('Control+Enter');
        await page.waitForFunction(() => document.querySelector('#feedback').dataset.phase === 'error');
        await clock(); assert.equal(await input.inputValue(),text); assert.equal(await page.locator('#history').textContent(),before);
      }
      async function noWaterOwnership() {
        assert.doesNotMatch(await page.locator('#inventory').textContent(),/瓶装水|bottled-water/);
        assert.ok(!(await page.locator('button').allTextContents()).some(t => /(?:检查|喝|饮用).*水/.test(t)));
        assert.doesNotMatch(await page.locator('#experience').innerHTML(), /sealed|weightKg|cabinet-scope/);
      }
      for (const entry of ['prototype','character']) {
        const response = await page.goto(origin); assert.equal(await response.text(),fs.readFileSync('dist/index.html','utf8'));
        if(entry==='prototype') await page.locator('#enter').click();
        else { await page.locator('#new-game').click(); await page.locator('#character-name').fill('柜前的幸存者'); await page.locator('#preview-character').click(); await page.locator('#start-character').click(); }
        minutes=0; await clock(); assert.equal(await cabinet.count(),1); assert.equal(await cabinet.isVisible(),true);
        assert.equal(await page.locator('#search').textContent(),'搜索房间');
        assert.doesNotMatch(await page.locator('#experience').innerHTML(), /瓶装水|bottled-water|sealed|柜内有|毫升/);
        await noWaterOwnership(); await shot(`${entry}-initial`); run.steps.push(`${entry}: known cabinet but no bottle in visible or hidden DOM; original room button and free input retained.`);
        // Direct entry starts by button; created entry starts by a complete free sentence.
        if(entry==='prototype') { await cabinet.click(); minutes++; await clock(); } else await act('请搜索一下这个柜子');
        assert.match(await page.locator('#narrative').textContent(), /发现瓶装水.*仍在柜中/);
        assert.equal(await page.getByRole('button',{name:'拾取瓶装水',exact:true}).count(),1);
        assert.equal(await page.locator('#inventory-list li').count(),0); await noWaterOwnership(); await shot(`${entry}-first`);
        run.steps.push(`${entry}: first search at minute1 discovers bottle, does not acquire or assert safety/volume.`);
        if(entry==='prototype') await act('搜索柜子'); else { await cabinet.click(); minutes++; await clock(); }
        assert.match(await page.locator('#narrative').textContent(), /没有新发现/); assert.doesNotMatch(await page.locator('#narrative').textContent(), /空了|已获得|安全|毫升/);
        await cabinet.dblclick(); minutes++; await clock();
        await cabinet.focus(); await cabinet.press('Enter'); minutes++; await clock();
        await cabinet.dispatchEvent('keydown',{key:'Enter',code:'Enter',repeat:true,bubbles:true}); await cabinet.dispatchEvent('keydown',{key:' ',code:'Space',repeat:true,bubbles:true});
        await clock(); assert.equal(await cabinet.evaluate(el => document.activeElement===el),true); await noWaterOwnership();
        run.steps.push(`${entry}: button/text repeat plus physical double click and held-key probes each preserve single settlement and target focus; minute4.`);
        await page.locator('#search').click(); minutes++; await clock(); assert.match(await page.locator('#narrative').textContent(),/发现空罐/);
        await page.getByRole('button',{name:'拾取空罐',exact:true}).click(); minutes++; await clock();
        assert.equal(await page.locator('#inventory-list li').textContent(),'空罐 · 数量 1 · 0.05 kg');
        assert.equal(await page.locator('[data-stat="carryWeightKg"] .status-value').textContent(),'0.05 kg');
        await noWaterOwnership(); run.steps.push(`${entry}: original room search and tin pickup work at minutes5/6, only tin in inventory and load0.05kg.`);
        const move=page.locator('#move-targets button'); await move.dblclick({delay:40}); minutes++; await clock();
        assert.equal(await move.evaluate(el=>el===document.activeElement),true);
        assert.equal(await cabinet.isVisible(),false); await refuse('搜索柜子');
        await act('前往房间'); assert.equal(await cabinet.isVisible(),true); await act('搜索柜子');
        assert.match(await page.locator('#narrative').textContent(),/没有新发现/); await noWaterOwnership(); run.steps.push(`${entry}: leave rejects remote cabinet, return restores target and repeat retains prior discovery.`);
        for (const text of ['检查瓶装水','喝水','搜索柜子然后喝水']) await refuse(text);
        await noWaterOwnership(); await shot(`${entry}-refused`); run.steps.push(`${entry}:3 unsupported inspection/consumption/compound inputs retain draft and time9 with zero ownership change.`);
        await act(entry==='prototype'?'拿起瓶装水':'拾取瓶装水');
        assert.equal(await page.locator('#inventory-list li').count(),2);
        assert.equal(await page.locator('[data-stat="carryWeightKg"] .status-value').textContent(),'0.55 kg');
        await act('请观察一下四周'); await cabinet.click(); minutes++; await clock();
        await page.locator('#inventory summary').click(); assert.equal(await page.locator('#inventory-list li').count(),2);
        assert.match(await page.locator('#narrative').textContent(),/没有新发现.*已取出/);
        assert.match(await page.locator('#feedback').textContent(), /尚未保存/); assert.equal(await input.isEditable(),true);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth));
        for (const selector of ['#narrative','#action','#submit','#feedback']) { await page.locator(selector).scrollIntoViewIfNeeded(); const b=await page.locator(selector).boundingBox(); assert.ok(b.x>=0&&b.x+b.width<=viewport.width+1); }
        await shot(`${entry}-recovered`); run.steps.push(`${entry}: water acquired once; recovery/search at time12 reports removed water, two owned items/load0.55kg, no overflow or lost free-input access.`);
      }
      assert.deepEqual(run.errors,[]); assert.ok(run.requests.every(url=>url.startsWith(origin))); run.status='passed'; await context.close();
    }
    evidence.status='passed';
  } catch(error) { evidence.status='failed'; evidence.failure=error.stack; throw error; }
  finally { fs.writeFileSync(path.join(dir,'browser-results.json'),JSON.stringify(evidence,null,2)+'\n'); await browser.close(); }
  console.log(JSON.stringify({status:evidence.status,runs:evidence.runs.map(r=>({viewport:r.viewport,groups:r.steps.length,screenshots:r.screenshots.length}))}));
})().catch(error=>{console.error(error);process.exitCode=1;});
