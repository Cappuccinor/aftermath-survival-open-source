const assert = require('node:assert/strict');
const fs = require('node:fs');
const { stripTypeScriptTypes } = require('node:module');
module.exports = async function verifyPickup({page,run,viewport,shot}) {
  page.setDefaultTimeout(5000);
  const input=page.locator('#action'),pickup=page.locator('#pickup'),inventory=page.locator('#inventory');
  const clock=async m=>page.waitForFunction(t=>document.querySelector('#clock').textContent.includes(t),`08:${String(m).padStart(2,'0')}`);
  async function start(entry){await page.reload();if(entry==='character'){await page.locator('#new-game').click();await page.locator('#character-name').fill('拾罐的人');await page.locator('#preview-character').click();await page.locator('#start-character').click();}else await page.locator('#enter').click();await clock(0);}
  const empty=async()=>{assert.equal(await pickup.isVisible(),false);assert.equal(await inventory.isVisible(),true);assert.doesNotMatch(await page.locator('body').textContent(),/空罐/);};
  const owned=async()=>{
    assert.equal(await pickup.isVisible(),false);assert.equal(await page.locator('#inspect-targets button').count(),0);
    assert.equal(await page.locator('#inventory-list li').count(),1);
    assert.equal(await page.locator('#inventory-list li').textContent(),'空罐 · 数量 1 · 0.05 kg');
    assert.equal(await page.locator('[data-stat="carryWeightKg"] .status-value').textContent(),'0.05 kg');
    assert.doesNotMatch(await inventory.textContent(),/metadata|prototype|NPC|durability|source|rng/);
  };
  for(const entry of ['prototype','character']){
    await start(entry);await empty();assert.equal(await inventory.getAttribute('open'),null);
    await page.locator('#inventory summary').click();assert.equal(await page.locator('#inventory-empty').isVisible(),true);await clock(0);
    await input.fill('拾取空罐');await page.locator('#submit').click();await page.waitForFunction(()=>document.querySelector('#feedback').dataset.phase==='error');await clock(0);assert.equal(await input.inputValue(),'拾取空罐');
    await shot(`pickup-${entry}-undiscovered`);run.steps.push(`${entry}: hidden undiscovered tin, empty readonly inventory, direct text pickup refused without search/action.`);
    await page.locator('#search').click();await clock(1);assert.equal(await pickup.isVisible(),true);
    await page.locator('#inspect-targets button').click();await clock(2);
    await page.locator('#player-status summary').click();await input.fill('保留我的下一步草稿');
    await page.evaluate(()=>{window.__pickupTrace=[];for(const type of ['mousedown','click','focusin','focusout'])document.addEventListener(type,event=>window.__pickupTrace.push({type,id:event.target.id,detail:event.detail,focus:document.activeElement.id,scroll:scrollY,pickupY:document.querySelector('#pickup').getBoundingClientRect().y}),{capture:true});});
    if(entry==='prototype')await pickup.dblclick({delay:40});
    else {await pickup.focus();await page.keyboard.down('Enter');await page.keyboard.down('Enter');await page.keyboard.up('Enter');}
    await clock(3);await owned();(run.pickupActivationTraces??=[]).push({entry,events:await page.evaluate(()=>window.__pickupTrace)});assert.equal(await page.evaluate(()=>document.activeElement.id),'action');
    assert.equal(await input.inputValue(),'保留我的下一步草稿');
    assert.equal(await inventory.getAttribute('open'),'');assert.equal(await page.locator('#player-status').getAttribute('open'),'');
    assert.equal(await page.locator('#narrative').textContent(),'你花了一分钟拾起空罐。');assert.match(await page.locator('#feedback').textContent(),/尚未保存/);
    assert.equal(await page.locator('#history li').count(),3);
    await shot(`pickup-${entry}-owned`);run.steps.push(`${entry}: search/inspect, ${entry==='prototype'?'physical double-click':'held Enter'} pickup settles once; focus moves to free input, draft/status/inventory expansion retained; one item and0.05kg.`);
    for(const phrase of ['拾取空罐','我准备拾取空罐','拾取空罐并离开','拾取2个空罐','拾取柜内空罐']){
      await input.fill(phrase);await input.press('Control+Enter');await page.waitForFunction(()=>document.querySelector('#feedback').dataset.phase==='error');await clock(3);assert.equal(await input.inputValue(),phrase);await owned();
    }
    await page.locator('#search').click();await clock(4);assert.match(await page.locator('#narrative').textContent(),/没有新发现/);
    await page.locator('#move-targets button').click();await clock(5);await owned();
    await page.locator('#move-targets button').click();await clock(6);await owned();
    await page.locator('#door-gap').click();await clock(7);await owned();
    assert.match(await page.locator('#narrative').textContent(),/透过门缝观察/);
    if(entry==='character'){await page.locator('#character-profile summary').click();assert.match(await page.locator('#character-profile').textContent(),/拾罐的人/);await clock(7);}
    await shot(`pickup-${entry}-persistent`);run.steps.push(`${entry}: repeated/compound/preparatory/count/container refusals retain world; search no respawn; leave/return/door preserves ownership/weight and self profile.`);
    await page.locator('#player-status summary').click();
    for(const selector of ['#narrative','#inventory summary','#action','#submit','#feedback']){const target=page.locator(selector);await target.scrollIntoViewIfNeeded();const box=await target.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=viewport.width+1&&box.y<viewport.height&&box.y+box.height>0);}
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await shot(`pickup-${entry}-recovered`);run.steps.push(`${entry}: narrative, inventory and permanent free input reachable at requested viewport; no horizontal overflow.`);
    for(const phrase of ['拾取空罐','捡起空罐','拿起空罐']){
      await start(entry);await page.locator('#search').click();await clock(1);
      await input.fill(phrase);await input.press('Control+Enter');await clock(2);await owned();assert.equal(await input.inputValue(),'');
    }
    run.steps.push(`${entry}: all three equivalent full texts execute real pickup in separate fresh worlds without automatic searching.`);
  }
  // Isolated presentation contract, separate from production and no gameplay/debug injection.
  const source=stripTypeScriptTypes(fs.readFileSync('src/ui/inventory.ts','utf8'),{mode:'strip'});
  const isolated=await page.context().newPage();
  try{
    await isolated.setContent('<main id="root"></main>');
    await isolated.evaluate(async code=>{const url=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));const {createInventoryPanel}=await import(url);URL.revokeObjectURL(url);
      const panel=createInventoryPanel(document);document.querySelector('#root').append(panel.element);panel.element.open=true;
      const states=[];for(const value of [null,[],[{itemId:'tin',label:'空罐',count:1,weightKg:.05}],null]){panel.render(value);states.push({text:panel.element.textContent,open:panel.element.open,unavailable:!panel.element.querySelector('#inventory-unavailable').hidden,empty:!panel.element.querySelector('#inventory-empty').hidden,rows:panel.element.querySelectorAll('li').length});}window.__states=states;
    },source);
    const states=await isolated.evaluate(()=>window.__states);assert.match(states[0].text,/随身物品暂不可用/);assert.match(states[1].text,/暂无随身物品/);assert.match(states[2].text,/空罐 · 数量 1 · 0.05 kg/);assert.match(states[3].text,/随身物品暂不可用/);assert.ok(states.every(s=>s.open));
    assert.deepEqual(states.map(s=>[s.unavailable,s.empty,s.rows]),[[true,false,0],[false,true,0],[false,false,1],[true,false,0]]);
    run.steps.push('Isolated source component: null/empty/owned/null honest messages and expansion preservation (not production gameplay).');
  }finally{await isolated.close();}
};
