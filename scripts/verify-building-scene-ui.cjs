const assert=require('node:assert/strict');
const fs=require('node:fs');
const {stripTypeScriptTypes}=require('node:module');
module.exports=async function verifyBuilding({page,run,viewport,shot}){
  page.setDefaultTimeout(5000);
  const input=page.locator('#action');
  const clock=async n=>page.waitForFunction(t=>document.querySelector('#clock').textContent.includes(t),`08:${String(n).padStart(2,'0')}`);
  const context=()=>page.locator('#scene-context');
  const check=async role=>{
    assert.equal(await context().isVisible(),true);
    assert.equal(await page.locator('#scene-title').textContent(),`废弃居民楼 · ${role}`);
    assert.match(await page.locator('#scene-description').textContent(),role==='房间'?/房门通向已知的相邻走廊。光线足够/:/沿已知路线可以返回刚才的房间。光线不足/);
    assert.doesNotMatch(await context().textContent(),/空罐|鞋|衣料|枪|NPC|安全|无人|警觉|暴露|脚步|窗户|裂墙|气味|prototype|metadata|rng/i);
  };
  const owned=async()=>{assert.equal(await page.locator('#inventory-list li').count(),1);assert.match(await page.locator('#inventory-list').textContent(),/空罐 · 数量 1 · 0.05 kg/);assert.equal(await page.locator('[data-stat="carryWeightKg"] .status-value').textContent(),'0.05 kg');};
  for(const entry of ['prototype','character']){
    await page.reload();assert.equal(await page.locator('#experience').isVisible(),false);
    if(entry==='character'){
      await page.locator('#new-game').click();await page.locator('#character-name').fill('楼中行者');await page.locator('#preview-character').click();
      assert.match(await page.locator('#character-preview').textContent(),/实际起点：废弃居民楼 · 房间/);
      assert.equal(await page.locator('#experience').isVisible(),false);await shot('building-preview');
      await page.locator('#cancel-character').click();await page.locator('#new-game').click();
      assert.equal(await page.locator('#character-name').inputValue(),'楼中行者');await page.locator('#preview-character').click();await page.locator('#start-character').dblclick({delay:40});
      run.steps.push('Character preview uses building start; cancel preserves draft, explicit double-click confirmation installs once.');
    }else await page.locator('#enter').click();
    await clock(0);await check('房间');assert.equal(await page.evaluate(()=>document.activeElement.id),'action');
    assert.doesNotMatch(await page.locator('body').textContent(),/空罐|旧鞋|衣料摩擦/);
    assert.equal(await page.locator('#narrative').textContent(),'尚未行动。下一步由你决定。');
    await shot(`building-${entry}-initial`);run.steps.push(`${entry}: known building/room and light opening, no hidden item/NPC or automatic time advance.`);
    await page.locator('#player-status summary').click();await page.locator('#inventory summary').click();await clock(0);
    for(const text of ['搜遍整栋楼','走上楼梯','躲藏','与NPC对话','攻击','我准备离开','不要观察','搜索并拾取','把饥饿设成0']){
      await input.fill(text);await input.press('Control+Enter');await page.waitForFunction(()=>document.querySelector('#feedback').dataset.phase==='error');
      await clock(0);await check('房间');assert.equal(await input.inputValue(),text);assert.equal(await page.locator('#history li').count(),0);
    }
    run.steps.push(`${entry}: nine unsupported/preparatory/compound/cheating inputs rejected with draft and scene unchanged.`);
    await input.fill('看看周围');await input.press('Control+Enter');await clock(1);
    assert.match(await page.locator('#narrative').textContent(),/光线足够/);await check('房间');
    await page.locator('#door-gap').click();await clock(2);await check('房间');
    await page.locator('#search').click();await clock(3);await page.locator('#inspect-targets button').click();await clock(4);
    await input.fill('保留我的想法');await page.locator('#pickup').click();await clock(5);await owned();await check('房间');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'action');assert.equal(await input.inputValue(),'保留我的想法');
    assert.equal(await page.locator('#inventory').getAttribute('open'),'');assert.equal(await page.locator('#player-status').getAttribute('open'),'');
    await shot(`building-${entry}-picked`);run.steps.push(`${entry}: real observe/door/search/inspect/pickup, separate scene context, focus/draft/expanded panels preserved.`);
    const picked=await page.locator('#narrative').textContent();await page.locator('#move-targets button').click();await clock(6);await check('走廊');await owned();
    assert.ok((await page.locator('#history li').allTextContents()).includes(picked));assert.equal(await page.locator('#narrative').textContent(),'你花了一分钟来到走廊。');
    await page.locator('#recent summary').click();await clock(6);await check('走廊');
    await shot(`building-${entry}-corridor`);run.steps.push(`${entry}: corridor dim context updates; picked result stays historical, browsing history consumes no time.`);
    await page.locator('#move-targets button').click();await clock(7);await check('房间');await owned();
    await page.locator('#search').click();await clock(8);assert.match(await page.locator('#narrative').textContent(),/没有新发现/);await check('房间');await owned();
    await input.fill('观察四周');await input.press('Control+Enter');await clock(9);assert.equal(await input.inputValue(),'');
    assert.match(await page.locator('#feedback').textContent(),/尚未保存/);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await shot(`building-${entry}-returned`);run.steps.push(`${entry}: return/no new findings/input recovery preserves inventory and context; no overflow, honest unsaved.`);
  }
  const source=stripTypeScriptTypes(fs.readFileSync('src/ui/scene-context.ts','utf8'),{mode:'strip'}),isolated=await page.context().newPage();
  try{
    await isolated.setContent('<main></main>');
    const states=await isolated.evaluate(async code=>{const url=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));const {createSceneContextPanel}=await import(url);URL.revokeObjectURL(url);const p=createSceneContextPanel(document);document.querySelector('main').append(p.element);
      return [null,{scene:'abandoned-residential-building-v1',locationId:'room',locationRole:'room',light:'dim'},null].map(c=>{p.render(c);return {hidden:p.element.hidden,text:p.element.textContent};});},source);
    assert.deepEqual(states.map(s=>s.hidden),[true,false,true]);assert.equal(states[0].text,'');assert.equal(states[2].text,'');assert.match(states[1].text,/光线不足/);
    run.steps.push('Isolated source component: absent/dim room/absent hides stale content honestly (not production injection).');
  }finally{await isolated.close();}
};
