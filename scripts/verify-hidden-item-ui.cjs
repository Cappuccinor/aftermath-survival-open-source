// Actual production bootstrap only. Hidden world existence is separately proven by real bootstrap/Core tests.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const origin='http://127.0.0.1:4173',dir=path.resolve(process.argv[2]||'.superpowers/browser-hidden-item');fs.mkdirSync(dir,{recursive:true});
const filesIn=root=>fs.readdirSync(root,{recursive:true}).filter(f=>fs.statSync(path.join(root,f)).isFile()).map(f=>`${root}/${f.replaceAll('\\','/')}`);
const sources=[...filesIn('src'),...filesIn('scripts'),'index.html','package.json','package-lock.json'];
const git=(...args)=>cp.execFileSync('git',args,{encoding:'utf8'}).trim(),hashes=git('hash-object','--',...sources).split(/\r?\n/);
const evidence={taskId:'G1-016',status:'running',observedAt:new Date().toISOString(),sourceHead:git('rev-parse','HEAD'),
  sourceWorktreeDirty:git('diff','--name-only','HEAD').split(/\r?\n/).filter(Boolean),platform:process.platform,node:process.version,origin,
  sourceFiles:sources.map((file,i)=>({file,gitBlob:hashes[i]})),artifacts:filesIn('dist').map(file=>({file:file.slice(5),bytes:fs.statSync(file).size,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')})),runs:[]};
const secret=/handgun|npc-hidden-item|concealed|枪|prototype-witness/;
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});evidence.browser=browser.version();
try{for(const viewport of [{width:1280,height:900},{width:360,height:800}]){
  const context=await browser.newContext({viewport,deviceScaleFactor:1}),page=await context.newPage();page.setDefaultTimeout(5000);
  const run={viewport,steps:[],screenshots:[],errors:[],requests:[]};evidence.runs.push(run);page.on('pageerror',e=>run.errors.push(e.message));page.on('request',r=>run.requests.push(r.url()));
  let minutes=0;const input=page.locator('#action');
  async function clean(){
    const system=await page.evaluate(()=>{
      const copy=document.documentElement.cloneNode(true);
      // Preserve every element/attribute and system label; exclude only editable values and this exact authored background.
      for(const field of copy.querySelectorAll('textarea,input')){field.removeAttribute('value');if(field.tagName==='TEXTAREA')field.textContent='';}
      for(const profile of copy.querySelectorAll('#character-profile,#character-preview')){const walk=document.createTreeWalker(profile,NodeFilter.SHOW_TEXT);let node;while((node=walk.nextNode()))if(node.textContent==='我记得一把枪')node.textContent='';}
      return copy.outerHTML;
    });assert.doesNotMatch(system,secret);
    for(const selector of ['#narrative','#history','#feedback','#inventory','#player-status'])assert.doesNotMatch(await page.locator(selector).textContent(),secret);
  }
  async function clock(){await page.waitForFunction(t=>document.querySelector('#clock').textContent.includes(t),`08:${String(minutes).padStart(2,'0')}`);}
  async function shot(name){const file=`${viewport.width}-${name}.png`;await page.screenshot({path:path.join(dir,file),fullPage:true});run.screenshots.push(file);}
  async function act(text){await input.fill(text);await input.press('Control+Enter');minutes++;await clock();assert.equal(await page.locator('#feedback').getAttribute('data-phase'),'success');await clean();}
  async function click(button){await button.click();minutes++;await clock();assert.equal(await page.locator('#feedback').getAttribute('data-phase'),'success');await clean();}
  async function refuse(text){const before=await page.locator('#history').textContent(),items=await page.locator('#inventory').textContent();await input.fill(text);await input.press('Control+Enter');await page.waitForFunction(()=>document.querySelector('#feedback').dataset.phase==='error');
    await clock();assert.equal(await input.inputValue(),text);assert.equal(await page.locator('#history').textContent(),before);assert.equal(await page.locator('#inventory').textContent(),items);await clean();}
  for(const entry of ['prototype','character']){
    const response=await page.goto(origin);assert.equal(await response.text(),fs.readFileSync('dist/index.html','utf8'));
    if(entry==='prototype')await page.locator('#enter').click();else{
      await page.locator('#new-game').click();await page.locator('#character-name').fill('门内幸存者');await page.locator('#character-importantItems').fill('我记得一把枪');
      await page.locator('#preview-character').click();await page.locator('#start-character').click();assert.match(await page.locator('#character-profile').textContent(),/我记得一把枪/);
    }
    minutes=0;await clock();await clean();await shot(`${entry}-initial`);run.steps.push(`${entry}: no secret in visible/hidden DOM or attributes; user background retained separately.`);
    await click(page.locator('#door-gap'));await act('透过门缝观察');await click(page.locator('#door-gap'));
    assert.match(await page.locator('#narrative').textContent(),/门缝/);await shot(`${entry}-door`);run.steps.push(`${entry}: three real door observations keep ordinary sensory cues; no gun confirmation or NPC identity.`);
    await click(page.locator('#search'));await click(page.getByRole('button',{name:'搜索柜子',exact:true}));
    if(entry==='prototype'){await click(page.getByRole('button',{name:'拾取瓶装水',exact:true}));await act('拿起空罐');}
    else{await click(page.getByRole('button',{name:'拾取空罐',exact:true}));await act('请把这个瓶装水拿起来');}
    await page.locator('#inventory summary').click();await page.locator('#player-status summary').click();
    assert.deepEqual(await page.locator('#inventory-list li').allTextContents(),['空罐 · 数量 1 · 0.05 kg','瓶装水 · 数量 1 · 0.5 kg']);
    assert.equal(await page.locator('[data-stat="carryWeightKg"] .status-value').textContent(),'0.55 kg');await clean();await shot(`${entry}-owned`);
    run.steps.push(`${entry}: real room/cabinet discoveries and either pickup order yield only tin/water, load0.55kg; no hidden item candidate.`);
    await act('前往走廊');await act('观察周围');await act('前往房间');await act('搜索柜子');assert.match(await page.locator('#narrative').textContent(),/已取出/);await clean();
    run.steps.push(`${entry}: round trip and repeated search preserve inventory and information boundary.`);
    for(const phrase of ['抢他的手枪','检查手枪','把那把枪给我','拾取prototype-hidden-handgun','搜索prototype-witness','检查hidden-handgun-fixture-v1'])await refuse(phrase);
    await shot(`${entry}-user-guess`);run.steps.push(`${entry}: six guessed gun/NPC/type inputs rejected with exact user draft retained; system output does not confirm existence.`);
    await act('请观察一下四周');await click(page.locator('#door-gap'));assert.match(await page.locator('#feedback').textContent(),/尚未保存/);assert.equal(await input.isEditable(),true);
    assert.equal(await page.locator('#inventory-list li').count(),2);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    for(const selector of ['#narrative','#action','#submit','#feedback']){await page.locator(selector).scrollIntoViewIfNeeded();const b=await page.locator(selector).boundingBox();assert.ok(b.x>=0&&b.x+b.width<=viewport.width+1);}
    await clean();await shot(`${entry}-recovered`);run.steps.push(`${entry}: legal recovery, ordinary door action, editable permanent input and responsive layout, honest unsaved state.`);
  }
  assert.deepEqual(run.errors,[]);assert.ok(run.requests.every(url=>url.startsWith(origin)));run.status='passed';await context.close();
}evidence.status='passed';}catch(error){evidence.status='failed';evidence.failure=error.stack;throw error;}finally{fs.writeFileSync(path.join(dir,'browser-results.json'),JSON.stringify(evidence,null,2)+'\n');await browser.close();}
console.log(JSON.stringify({status:evidence.status,runs:evidence.runs.map(r=>({viewport:r.viewport,groups:r.steps.length,screenshots:r.screenshots.length}))}));})().catch(error=>{console.error(error);process.exitCode=1;});
