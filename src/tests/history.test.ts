import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { projectHistoryPage, createHistoryController } from '../application/history';
import { createEngine } from '../core/engine';
import { createLifecyclePrototype, createLifecycleGame } from '../core/npc-lifecycle-prototype';
import { readActionReceipts } from '../core/receipts';
import { decodeSave } from '../adapters/storage/save-format';
import { action, sequence } from './hidden-item-fixtures';
import { doorCommand, doorFixture, doorVectors, doorCharacter, doorMetadata } from './door-fixtures';
import type { WorldState } from '../core/world';

function acted(count: number) {
  const e=createEngine(createLifecyclePrototype());
  for(let i=0;i<count;i++)expect(e.dispatch(action('observe',i)).ok).toBe(true);
  return e.snapshot();
}
const safe=(value:unknown)=>expect(JSON.stringify(value)).not.toMatch(/commandId|payload|eventJournal|prototype-|worldState|rngState|checksums|alertness|hidden-handgun|unspecified-pre-game-death|PRIVATE_SECRET|<img/);
describe('visible persistent history projection',()=>{
  for(const count of [0,1,20,21,40,41])it('keeps every one of '+count+' receipts in fixed pages',()=>{
    const world=acted(count),before=JSON.stringify(world),history=createHistoryController(world).client;
    const latest=history.read();expect(latest.total).toBe(count);expect(latest.pages).toBe(Math.ceil(count/20));expect(latest.page).toBe(latest.pages);
    const entries=[];
    for(let page=1;page<=latest.pages;page++){history.selectPage(page);const v=history.read();expect(v.from).toBe((page-1)*20+1);expect(v.to).toBe(Math.min(page*20,count));expect(v.canEarlier).toBe(page>1);expect(v.canNewer).toBe(page<latest.pages);expect(v.entries.length).toBe(v.to-v.from+1);entries.push(...v.entries);expect(Object.isFrozen(v)).toBe(true);expect(Object.isFrozen(v.entries)).toBe(true);v.entries.forEach(x=>{expect(Object.isFrozen(x)).toBe(true);expect(Object.keys(x).sort()).toEqual(['summary','timeLabel']);});safe(v);}
    expect(entries).toHaveLength(count);if(count){expect(entries[0]!.timeLabel).toContain('08:01');expect(entries.at(-1)!.timeLabel).toContain('08:'+String(count).padStart(2,'0'));}else expect(latest).toMatchObject({page:0,pages:0,from:0,to:0,entries:[]});expect(JSON.stringify(world)).toBe(before);
  });
  it('rejects malformed page requests without coercion or exposing extra data',()=>{
    const world=acted(21),c=createHistoryController(world).client;c.selectPage(1);const before=c.read();let touched=0;const bad={get valueOf(){touched++;throw Error('getter');}};
    for(const input of [-1,0,3,1.2,NaN,Infinity,'2',null,undefined,{},[],bad,new Number(2)]){c.selectPage(input);expect(c.read()).toBe(before);}expect(touched).toBe(0);safe(c.read());
  });
  it('does not reset older page on same receipt replay and resets only for a new commit',()=>{
    const w=acted(21),c=createHistoryController(w);c.client.selectPage(1);const before=c.client.read();c.update(w);c.update(createEngine(w).snapshot());expect(c.client.read()).toBe(before);const e=createEngine(w);e.dispatch(action('observe',21));c.update(e.snapshot());expect(c.client.read()).toMatchObject({page:2,total:22});
  });
  it('disposes old callbacks and pages without reaching another world',()=>{
    const a=createHistoryController(acted(21)),b=createHistoryController(acted(1));let calls=0;a.client.subscribe(()=>calls++);a.dispose();a.client.selectPage(1);a.update(acted(22));a.client.subscribe(()=>calls++);expect(calls).toBe(1);expect(a.client.read().total).toBe(0);expect(b.client.read().total).toBe(1);
  });
  for(const vector of doorVectors)it('records only then-visible door evidence for seed '+vector.seed,()=>{
    const e=createEngine(doorFixture(vector.seed));expect(e.dispatch(doorCommand()).ok).toBe(true);const v=projectHistoryPage(e.snapshot()),text=v.entries[0]!.summary;
    expect(text).toContain('当时');expect(text.includes('旧鞋')).toBe(vector.visual==='shoes');expect(text.includes('模糊的影子')).toBe(vector.visual==='shadow');expect(text.includes('未能辨清')).toBe(vector.visual==='none');expect(text.includes('衣料摩擦')).toBe(vector.noticed);expect(text).not.toMatch(/警觉|死亡|尸体|概率|看见了人|手枪/);safe(v);
  });
  for(const status of ['alive','dead'] as const)it('uses only historical evidence for '+status+' NPC',()=>{
    const e=createEngine(createLifecyclePrototype(1,status));expect(e.dispatch(doorCommand()).ok).toBe(true);const r=readActionReceipts(e.snapshot())[0]!;const v=projectHistoryPage(e.snapshot());expect(v.entries[0]!.summary.includes('衣料摩擦')).toBe('noticed'in r&&r.noticed);expect(JSON.stringify(v)).not.toMatch(/死亡|尸体|警觉|持枪/);safe(v);
  });
  it('preserves early water and movement facts after later pickup and knowledge',()=>{
    const e=createEngine(createLifecyclePrototype());let early='';for(const [i,[verb,target]]of sequence().entries()){expect(e.dispatch(action(verb,i,target)).ok).toBe(true);if(i===3)early=projectHistoryPage(e.snapshot()).entries[3]!.summary;}
    const v=projectHistoryPage(e.snapshot(),1);expect(v.entries[3]!.summary).toBe(early);expect(early).toContain('当时');expect(early).toContain('仍在柜中');expect(v.entries[7]!.summary).toContain('已取出');expect(v.entries[8]!.summary).toContain('走廊');expect(v.entries[10]!.summary).toContain('房间');safe(v);
  });
  it('never includes malicious character words or arbitrary metadata',()=>{
    const profile={...doorCharacter.profile,name:'<img PRIVATE_SECRET>',importantItems:'PRIVATE_SECRET hidden-handgun',wish:'PRIVATE_SECRET'};const e=createEngine(createLifecycleGame({...doorCharacter,profile},doorMetadata));expect(e.dispatch(action('observe',0,undefined,e.snapshot().player.playerId)).ok).toBe(true);safe(projectHistoryPage(e.snapshot()));
  });
  it('reads all 18 original fixtures without rewriting and covers every supported receipt rule',async()=>{
    const files=readdirSync('src/tests',{recursive:true}).map(String).filter(f=>f.endsWith('.json'));expect(files).toHaveLength(18);const rules=new Set<string>();
    for(const file of files){const path='src/tests/'+file,raw=readFileSync(path,'utf8'),input=JSON.parse(raw);const world:WorldState=input.format==='aftermath-save'?(await decodeSave(raw)).worldState:createEngine(input).snapshot();readActionReceipts(world).forEach(r=>rules.add(r.rule));const page=projectHistoryPage(world);expect(page.total).toBe(readActionReceipts(world).length);safe(page);expect(JSON.stringify(page)).not.toContain('当前尚未支持取出');expect(readFileSync(path,'utf8')).toBe(raw);}
    // Some rules only occur in generated current-world scenarios.
    const e=createEngine(createLifecyclePrototype());for(const [i,[verb,target]]of sequence().entries())e.dispatch(action(verb,i,target));readActionReceipts(e.snapshot()).forEach(r=>rules.add(r.rule));expect([...rules].sort()).toEqual(['observe-v1','inspect-v1','move-v1','search-v1','door-observe-v1','door-observe-v2','pick_up-v1','pick_up-v2','cabinet-search-v1','cabinet-search-v2'].sort());
  });
});
