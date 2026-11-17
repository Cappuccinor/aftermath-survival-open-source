// Actual production UI/native IndexedDB regression for G2-010-attempt-2.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto'),assert=require('node:assert/strict'),cp=require('node:child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=process.cwd(),out=path.resolve(process.argv[2]||'.superpowers/sdd/g2-010-attempt-2/browser'),baseline=process.argv[3]==='baseline';
assert.ok(!fs.existsSync(out),'Use a fresh evidence directory');fs.mkdirSync(out,{recursive:true});
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),git=(...args)=>cp.execFileSync('git',args,{encoding:'utf8'}).trim();
const files=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]);
const artifacts=files('dist').map(file=>({file,sha256:sha(fs.readFileSync(file))}));
if(baseline)for(const a of JSON.parse(fs.readFileSync('docs/evidence/g2-010/verification.json')).build.artifacts)assert.equal(sha(fs.readFileSync(path.join('dist',a.file))),a.sha256);
const sourceFiles=git('ls-files','src','index.html','package.json','package-lock.json','vite.config.ts','scripts/verify-g2-original-selection.cjs').split('\n').filter(Boolean).map(file=>({file,blob:git('hash-object',file)}));
const original=fs.readFileSync('src/tests/save-fixtures/v1.json');
const result={dispatchKey:'G2-010-attempt-2',head:git('rev-parse','HEAD'),distSource:baseline?'990a930bb0c372ea66f7cbc485d9dea8e414c9af':'working-tree-built-after-fix',sourceFiles,artifacts,startedAt:new Date().toISOString(),runs:[]};
const server=http.createServer((req,res)=>{const file=path.join(root,'dist',decodeURIComponent(new URL(req.url,'http://localhost').pathname));try{const p=fs.statSync(file).isDirectory()?path.join(file,'index.html'):file;res.setHeader('Content-Type',p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(p));}catch{res.statusCode=404;res.end();}});
const phase=(p,id,want)=>p.waitForFunction(({id,want})=>document.querySelector(id)?.dataset.phase===want,{id,want});
const db=p=>p.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('aftermath-survival',1);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const d=r.result,t=d.transaction(['heads','snapshots'],'readonly'),a=[];for(const s of ['heads','snapshots'])for(const q of [t.objectStore(s).getAllKeys(),t.objectStore(s).getAll()]){const i=a.length;a.push(null);q.onsuccess=()=>a[i]=q.result;}t.oncomplete=()=>{d.close();resolve(JSON.stringify(a));};t.onerror=()=>reject(t.error);};}));
async function chooseArchive(p){
 await p.locator('#originals-list').focus();await p.locator('#originals-list').press('Enter');await phase(p,'#originals-status','ready');
 const opts=await p.locator('#original-selector option').evaluateAll(es=>es.map(e=>({value:e.value,text:e.textContent}))),index=opts.findIndex(e=>e.text.includes('升级归档'));assert.ok(index>=0);
 await p.locator('#original-selector').focus();await p.locator('#original-selector').press('Home');
 for(let i=0;i<index;i++)await p.locator('#original-selector').press('ArrowDown');
 await p.locator('#original-selector').press('Enter');assert.equal(await p.locator('#original-selector').inputValue(),opts[index].value);
}
async function download(p,width,name){
 const before={db:sha(await db(p)),clock:await p.locator('#clock').textContent(),draft:await p.locator('#action').inputValue(),save:await p.locator('#save-status').textContent(),auto:await p.locator('#autosave-status').textContent()};
 const event=p.waitForEvent('download');await p.locator('#original-download').focus();await p.locator('#original-download').press('Enter');const d=await event;
 const file=path.join(out,`${width}-${name}.json`);await d.saveAs(file);assert.equal(sha(fs.readFileSync(file)),sha(original));await phase(p,'#originals-status','initiated');
 const after={db:sha(await db(p)),clock:await p.locator('#clock').textContent(),draft:await p.locator('#action').inputValue(),save:await p.locator('#save-status').textContent(),auto:await p.locator('#autosave-status').textContent()};assert.deepEqual(after,before);
 return{file:path.basename(file),sha256:sha(fs.readFileSync(file)),diskWorldDraftSaveAutoUnchanged:true};
}
(async()=>{let browser,page;try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));browser=await chromium.launch({channel:'chrome',headless:true});result.browser=browser.version();
 for(const width of [360,1280]){
  const c=await browser.newContext({viewport:{width,height:width===360?800:900},acceptDownloads:true});page=await c.newPage();const p=page;p.setDefaultTimeout(10000);const errors=[];p.on('pageerror',e=>errors.push(String(e)));
  await p.goto(`http://127.0.0.1:${server.address().port}`);await p.waitForFunction(()=>!!document.querySelector('#save-slot-selector')&&!document.querySelector('#save-slot-selector').disabled);
  await p.locator('#import-file').setInputFiles({name:'world.json',mimeType:'application/json',buffer:original});await phase(p,'#import-status','confirm');await p.locator('#import-confirm').click();await phase(p,'#import-status','imported');
  await p.locator('#migration-check').click();await phase(p,'#migration-status','confirm');await p.locator('#migration-confirm').click();await phase(p,'#migration-status','completed');
  await p.locator('#manual-load').click();await p.waitForFunction(()=>['saved','confirm'].includes(document.querySelector('#save-status')?.dataset.phase));if(await p.locator('#save-status').getAttribute('data-phase')==='confirm')await p.locator('#confirm-persistence').click();await phase(p,'#save-status','saved');
  await chooseArchive(p);const oldClock=await p.locator('#clock').textContent();await p.locator('#action').fill('观察周围');await p.locator('#action').press('Control+Enter');await p.waitForFunction(old=>document.querySelector('#clock').textContent!==old,oldClock);
  await p.waitForFunction(()=>!document.querySelector('#originals-list').disabled);await p.locator('#action').fill('保留这份草稿');
  const actionState={message:await p.locator('#originals-status').textContent(),disabled:await p.locator('#original-download').isDisabled(),choices:await p.locator('#original-selector option').count()};
  await p.screenshot({path:path.join(out,`${width}-after-action.png`),fullPage:true});
  assert.equal(actionState.disabled,true);assert.equal(actionState.choices,0);assert.match(actionState.message,/重新列出/);
  await chooseArchive(p);const downloads=[await download(p,width,'after-action')];
  await p.screenshot({path:path.join(out,`${width}-downloaded.png`),fullPage:true});
  // Saving without an intervening action must also invalidate a listed snapshot key.
  await chooseArchive(p);await p.locator('#manual-save').click();await phase(p,'#save-status','saved');assert.equal(await p.locator('#original-download').isDisabled(),true);assert.match(await p.locator('#originals-status').textContent(),/重新列出/);
  await chooseArchive(p);downloads.push(await download(p,width,'after-save'));
  // Automatic saving preserves its permission/target; only the old selection is revoked.
  await p.locator('#enable-autosave').click();await p.waitForFunction(()=>document.querySelector('#autosave-status').dataset.mode==='on');await chooseArchive(p);
  const autoClock=await p.locator('#clock').textContent();await p.locator('#action').fill('观察周围');await p.locator('#action').press('Control+Enter');await p.waitForFunction(old=>document.querySelector('#clock').textContent!==old,autoClock);await phase(p,'#save-status','saved');await p.waitForFunction(()=>!document.querySelector('#originals-list').disabled);
  assert.equal(await p.locator('#original-download').isDisabled(),true);assert.equal(await p.locator('#autosave-status').getAttribute('data-mode'),'on');
  await p.locator('#action').fill('自动保存后仍保留草稿');await chooseArchive(p);downloads.push(await download(p,width,'after-auto'));
  // A rejected free action must leave a still valid choice usable.
  await p.locator('#action').fill('我要杀死 NPC');await p.locator('#action').press('Control+Enter');await p.waitForFunction(()=>!document.querySelector('#original-download').disabled);downloads.push(await download(p,width,'after-rejection'));
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
  await p.screenshot({path:path.join(out,`${width}-after-auto.png`),fullPage:true});
  result.runs.push({width,actionState,downloads,keyboard:true,manualAndAutoInvalidation:true,rejectedActionPreserved:true,noHorizontalOverflow:true,pageErrors:errors});await c.close();page=undefined;
 }
 result.status='passed';
}catch(e){result.status='failed';result.error=String(e.stack);if(page)await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});process.exitCode=1;
}finally{await browser?.close();await new Promise(r=>server.close(r));result.servicesClosed=true;result.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:result.status,error:result.error,runs:result.runs,servicesClosed:true}));}})();
