import type { VisibleInventory } from '../application/ports';
/** Read-only disclosure, preserving its identity/open state across action renders. */
export function createInventoryPanel(document:Document) {
  const element=document.createElement('details');element.id='inventory';
  const summary=document.createElement('summary');summary.textContent='随身物品';
  const empty=document.createElement('p');empty.id='inventory-empty';empty.textContent='暂无随身物品';
  const unavailable=document.createElement('p');unavailable.id='inventory-unavailable';unavailable.textContent='随身物品暂不可用';
  const list=document.createElement('ul');list.id='inventory-list';
  element.append(summary,empty,unavailable,list);
  function render(inventory:VisibleInventory|null) {
    empty.hidden=inventory===null||inventory.length>0;unavailable.hidden=inventory!==null;
    list.hidden=inventory===null||inventory.length===0;
    list.replaceChildren(...(inventory??[]).map(item=>{const row=document.createElement('li');
      row.textContent=`${item.label} · 数量 ${item.count} · ${item.weightKg} kg`;return row;}));
  }
  render(null);return {element,render};
}
