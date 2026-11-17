import { bootstrapNotice } from '../application/ports';
import type { ObservationSession, ObservationView, CharacterCreation, CharacterProfile, ManualPersistenceClient } from '../application/ports';
import { mountPersistence } from './persistence';
import { mountCharacterCreation, profileDetails } from './character-creation';
import { createPlayerStatusPanel } from './player-status';
import { createInventoryPanel } from './inventory';
import { createSceneContextPanel } from './scene-context';
import { createHistoryPanel } from './history';

/** Presentation receives only interaction capabilities and visible projections. */
export function mountObservationUI(root: HTMLElement, start: () => ObservationSession, creation?: CharacterCreation, persistence?: ManualPersistenceClient): () => void {
  const find = <T extends HTMLElement>(selector: string): T => {
    const element = root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing presentation element: ${selector}`);
    return element;
  };
  const intro = find('#intro'); const game = find('#experience');
  const playerStatus = createPlayerStatusPanel(root.ownerDocument);
  find('.world-line').after(playerStatus.element);
  const enter = find<HTMLButtonElement>('#enter'); const observe = find<HTMLButtonElement>('#observe');
  const doorButton = root.ownerDocument.createElement('button');
  doorButton.type = 'button'; doorButton.id = 'door-gap'; doorButton.className = 'suggestion';
  observe.after(doorButton);
  const greetButton=root.ownerDocument.createElement('button');greetButton.type='button';greetButton.id='greet';greetButton.className='suggestion';greetButton.textContent='向周围打招呼';doorButton.after(greetButton);
  const form = find<HTMLFormElement>('#action-form'); const input = find<HTMLTextAreaElement>('#action');
  const submit = find<HTMLButtonElement>('#submit'); const retry = find<HTMLButtonElement>('#retry');
  const feedback = find('#feedback'); const clock = find('#clock'); const narrative = find('#narrative');
  const history = find('#history'); const recent = find('#recent'); const startFeedback = find('#start-feedback');
  const scene = createSceneContextPanel(root.ownerDocument); find('.story').prepend(scene.element);
  const inventory = createInventoryPanel(root.ownerDocument); recent.after(inventory.element);
  const memory = createHistoryPanel(root.ownerDocument); inventory.element.after(memory.element);
  const inspectionSuggestions = find('#inspect-targets');
  const moveSuggestions = find('#move-targets');
  const searchButton = root.ownerDocument.createElement('button');
  searchButton.type = 'button';
  searchButton.className = 'suggestion';
  searchButton.id = 'search';
  moveSuggestions.after(searchButton);
  const extraSearch = root.ownerDocument.createElement('span'); extraSearch.id = 'search-targets';
  searchButton.after(extraSearch);
  const searchButtons = new Map<string, HTMLButtonElement>();
  const pickupButton = root.ownerDocument.createElement('button');
  pickupButton.type = 'button'; pickupButton.id = 'pickup'; pickupButton.className = 'suggestion'; searchButton.after(pickupButton);
  const extraPickup = root.ownerDocument.createElement('span'); extraPickup.id = 'pickup-targets'; pickupButton.after(extraPickup);
  const pickupButtons = new Map<string, HTMLButtonElement>();
  let primaryPickupId: string | undefined;
  const currentLocation = find('#current-location');
  // One stable route button retains native click count and keyboard focus when its destination changes.
  const moveButton = root.ownerDocument.createElement('button');
  moveButton.type = 'button'; moveButton.className = 'suggestion'; moveSuggestions.append(moveButton);
  const inspectionButtons = new Map<string, HTMLButtonElement>();
  find('#capability').textContent = persistence ? bootstrapNotice.replace('刷新页面会丢失进度。', '目前支持三个存档槽和可明确开启的自动保存；未保存的变化会丢失。') : bootstrapNotice;
  const handlers = new AbortController();
  let session: ObservationSession | undefined;
  let unsubscribe: (() => void) | undefined;
  let protectTransitionFocus = false;
  let pickupFocusTransfer = false;
  // If a held activation key follows focus into the textarea, do not turn it into draft text.
  root.ownerDocument.addEventListener('keydown', event => {
    if (pickupFocusTransfer && event.repeat && (event.key === 'Enter' || event.key === ' ')) event.preventDefault();
  }, { capture: true, signal: handlers.signal });
  root.ownerDocument.addEventListener('keyup', event => {
    if (event.key === 'Enter' || event.key === ' ') pickupFocusTransfer = false;
  }, { signal: handlers.signal });
  // The second pointer-down of a physical double-click can land on the newly shown page.
  // Protect only that transition; the next ordinary pointer-down clears the guard.
  root.ownerDocument.addEventListener('mousedown', event => {
    if (!protectTransitionFocus) return;
    protectTransitionFocus = false;
    if (event.detail > 1) { event.preventDefault(); input.focus({ preventScroll: true }); }
  }, { capture: true, signal: handlers.signal });
  function protectRepeatedKey(button: HTMLButtonElement) {
    button.addEventListener('keydown', event => {
      if (event.repeat && (event.key === 'Enter' || event.key === ' ')) event.preventDefault();
    }, { signal: handlers.signal });
  }
  protectRepeatedKey(searchButton);
  protectRepeatedKey(pickupButton);
  pickupButton.addEventListener('click', event => {
    const id = pickupButton.dataset.targetId;
    if (event.detail <= 1 && id) void session?.pickUp(id);
  }, { signal: handlers.signal });
  protectRepeatedKey(doorButton);
  protectRepeatedKey(greetButton);
  greetButton.addEventListener('click',event=>{if(event.detail<=1)void session?.greet?.();},{signal:handlers.signal});
  doorButton.addEventListener('click', event => {
    const id = doorButton.dataset.targetId;
    if (event.detail <= 1 && id) void session?.observeDoorGap(id);
  }, { signal: handlers.signal });
  searchButton.addEventListener('click', event => {
    const id = searchButton.dataset.targetId;
    if (event.detail <= 1 && id) void session?.search(id);
  }, { signal: handlers.signal });
  protectRepeatedKey(moveButton);
  moveButton.addEventListener('click', event => {
    const targetId = moveButton.dataset.targetId;
    if (event.detail <= 1 && targetId) void session?.move(targetId);
  }, { signal: handlers.signal });
  function render(view: ObservationView) {
    greetButton.hidden=!view.contactTarget;
    scene.render(view.sceneContext);
    playerStatus.render(view.playerStatus);
    inventory.render(view.inventory);
    // Bind each node once, including the legacy primary button. A second click can never pick another item.
    primaryPickupId ??= view.pickupTargets[0]?.targetId;
    const pickup = view.pickupTargets.find(target => target.targetId === primaryPickupId);
    // Do not scroll between the two pointer clicks: the second must not land on a different action.
    if (!pickup && root.ownerDocument.activeElement === pickupButton) {
      pickupFocusTransfer = true; protectTransitionFocus = true; input.focus({ preventScroll: true });
    }
    pickupButton.hidden = !pickup;
    if (pickup) { pickupButton.textContent = `拾取${pickup.label}`; pickupButton.dataset.targetId = pickup.targetId; }
    for (const target of view.pickupTargets.filter(target => target.targetId !== primaryPickupId)) {
      if (!pickupButtons.has(target.targetId)) {
        const button = root.ownerDocument.createElement('button'); button.type = 'button'; button.className = 'suggestion';
        button.dataset.targetId = target.targetId; button.textContent = `拾取${target.label}`;
        button.addEventListener('click', event => { if (event.detail <= 1) void session?.pickUp(target.targetId); }, { signal: handlers.signal });
        protectRepeatedKey(button); pickupButtons.set(target.targetId, button); extraPickup.append(button);
      }
    }
    for (const [id, button] of pickupButtons) {
      const available = view.pickupTargets.some(target => target.targetId === id);
      if (!available && root.ownerDocument.activeElement === button) {
        pickupFocusTransfer = true; protectTransitionFocus = true; input.focus({ preventScroll: true });
      }
      button.hidden = !available;
    }
    const door = view.doorTargets[0];
    doorButton.hidden = !door;
    doorButton.textContent = door ? `观察${door.label}` : '';
    doorButton.dataset.targetId = door?.targetId ?? '';
    currentLocation.textContent = view.currentLocation ? `当前位置：${view.sceneContext ? '废弃居民楼 · ' : ''}${view.currentLocation.label}` : '';
    const search = view.searchTargets[0];
    searchButton.hidden = !search;
    searchButton.textContent = search ? `搜索${search.label}` : '';
    searchButton.dataset.targetId = search?.targetId ?? '';
    // Stable per-target nodes: never reuse a cabinet button for another action after rendering.
    for (const [id, button] of searchButtons) {
      const target = view.searchTargets.slice(1).find(t => t.targetId === id);
      if (!target && root.ownerDocument.activeElement === button) {
        pickupFocusTransfer = true; protectTransitionFocus = true; input.focus({ preventScroll: true });
      }
      button.hidden = !target;
    }
    for (const target of view.searchTargets.slice(1)) {
      let button = searchButtons.get(target.targetId);
      if (!button) {
        button = root.ownerDocument.createElement('button'); button.type = 'button'; button.className = 'suggestion';
        button.dataset.targetId = target.targetId;
        button.addEventListener('click', event => { if (event.detail <= 1) void session?.search(target.targetId); }, { signal: handlers.signal });
        protectRepeatedKey(button); searchButtons.set(target.targetId, button); extraSearch.append(button);
      }
      button.hidden = false; button.textContent = `搜索${target.label}`;
    }
    const route = view.routes[0];
    moveButton.hidden = !route;
    moveButton.textContent = route ? `前往${route.label}` : '';
    moveButton.dataset.targetId = route?.targetId ?? '';
    clock.textContent = view.clock.label;
    narrative.textContent = view.entries.at(-1)?.summary ?? (view.sceneContext ? '尚未行动。下一步由你决定。' : view.inspectTargets.length
      ? `眼前可以看见${view.inspectTargets.map(target => target.label).join('、')}。你可以仔细检查，也可以写下自己的行动。`
      : '尚未观察。你可以先看看周围，也可以写下自己的行动。');
    feedback.textContent = persistence ? view.message.replace(/，进度(?:尚未|已)保存/, '').replace('未手动保存的变化会丢失。', '未保存的变化会丢失。') : view.message;
    feedback.dataset.phase = view.phase;
    form.setAttribute('aria-busy', String(view.phase === 'pending'));
    const locked = view.phase === 'pending' || view.canRetry || persistence?.read().busy === true;
    searchButton.disabled = locked;
    for (const button of searchButtons.values()) button.disabled = locked;
    greetButton.disabled=locked;
    doorButton.disabled = locked;
    pickupButton.disabled = locked;
    for (const button of pickupButtons.values()) button.disabled = locked;
    moveButton.disabled = locked; observe.disabled = locked; submit.disabled = locked;
    for (const [id, button] of inspectionButtons) {
      if (!view.inspectTargets.some(target => target.targetId === id)) { button.remove(); inspectionButtons.delete(id); }
    }
    for (const target of view.inspectTargets) {
      let button = inspectionButtons.get(target.targetId);
      if (!button) {
        button = root.ownerDocument.createElement('button'); button.type = 'button'; button.className = 'suggestion';
        button.addEventListener('click', event => { if (event.detail <= 1) void session?.inspect(target.targetId); }, { signal: handlers.signal });
        protectRepeatedKey(button); inspectionButtons.set(target.targetId, button); inspectionSuggestions.append(button);
      }
      // Keep the same node across async phases: preserve focus and native double-click detail.
      button.textContent = `检查${target.label}`; button.disabled = locked;
    }
    retry.hidden = !view.canRetry; retry.disabled = view.phase === 'pending' || persistence?.read().busy === true;
    if (input.value !== view.draft) input.value = view.draft;
    recent.hidden = view.entries.length === 0;
    history.replaceChildren(...view.entries.map(entry => {
      const item = root.ownerDocument.createElement('li'); item.textContent = entry.summary; return item;
    }));
  }
  function activate(candidate: ObservationSession, character: CharacterProfile | null = null, replacing = false) {
    if (session && !replacing) return;
    unsubscribe?.();
    if (replacing) {
      primaryPickupId = undefined;
      for (const button of pickupButtons.values()) button.remove(); pickupButtons.clear();
      root.querySelector('#character-profile')?.remove();
      const panel = root.querySelector<HTMLElement>('#character-creation'); if (panel) panel.hidden = true;
    }
    const stop = candidate.subscribe(render);
    memory.bind(candidate.history);
    if (character) {
      const details = root.ownerDocument.createElement('details'); details.id = 'character-profile';
      const summary = root.ownerDocument.createElement('summary'); summary.textContent = '我的角色资料';
      details.append(summary, profileDetails(root.ownerDocument, character)); recent.after(details);
    }
    session = candidate; unsubscribe = stop;
    protectTransitionFocus = true;
    intro.hidden = true; game.hidden = false; input.focus();
  }
  const disposeCreation = creation ? mountCharacterCreation(root, creation, result => activate(result.session, result.character)) : undefined;
  if (persistence) {
    const notice = root.querySelector('#character-notice');
    if (notice) notice.textContent = notice.textContent.replace('进度仅在本页内存中，刷新会丢失，尚不能保存。', '开始后可手动保存到选中的本机存档槽，再明确开启该槽自动保存。未保存的变化会丢失。');
  }
  const disposePersistence = persistence ? mountPersistence(root, persistence, result => activate(result.session, result.character, true)) : undefined;
  const stopPersistence = persistence?.subscribe(view => {
    const indicator = root.querySelector('.unsaved');
    if (indicator) indicator.textContent = view.phase === 'saving' ? (view.autosave.mode === 'saving' ? '正在自动保存' : '正在保存') : view.phase === 'error' ? '存档操作失败' : view.savedToSelected ? '当前目标已保存' : '当前目标未保存';
    if (session) render(session.read());
  });
  enter.addEventListener('click', event => {
    if (session || event.detail > 1) return;
    try {
      if (creation) {
        const result = creation.startPrototype();
        if (!result) throw new Error('Prototype unavailable');
        activate(result.session, result.character);
      } else activate(start());
    } catch { startFeedback.textContent = '体验暂时未能开始，请重试。'; }
  }, { signal: handlers.signal });
  input.addEventListener('input', () => session?.setDraft(input.value), { signal: handlers.signal });
  form.addEventListener('submit', event => { event.preventDefault(); void session?.submitText(); }, { signal: handlers.signal });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing && event.keyCode !== 229) {
      event.preventDefault(); if (!event.repeat) void session?.submitText();
    }
  }, { signal: handlers.signal });
  // A completed local action may resolve before the second click of one physical double-click.
  observe.addEventListener('click', event => { if (event.detail <= 1) void session?.observe(); }, { signal: handlers.signal });
  submit.addEventListener('click', event => { if (event.detail > 1) event.preventDefault(); }, { signal: handlers.signal });
  for (const button of [enter, observe, submit, retry]) protectRepeatedKey(button);
  retry.addEventListener('click', () => { void session?.retry(); }, { signal: handlers.signal });
  return () => { handlers.abort(); unsubscribe?.(); memory.dispose(); disposeCreation?.(); disposePersistence?.(); stopPersistence?.(); };
}
