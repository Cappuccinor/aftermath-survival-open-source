import { characterFields, characterSkills, characterNotice } from '../application/ports';
import type { CharacterCreation, CharacterDraft, CharacterProfile, StartedGame } from '../application/ports';

function element<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, text?: string) {
  const node = doc.createElement(tag); if (text !== undefined) node.textContent = text; return node;
}
export function profileDetails(doc: Document, character: CharacterProfile): HTMLElement {
  const list = element(doc, 'dl'); list.className = 'character-values';
  for (const [key, label] of characterFields) list.append(element(doc, 'dt', label), element(doc, 'dd', String(character.profile[key] || '未填写')));
  for (const [key, label] of characterSkills) list.append(element(doc, 'dt', `初始${label}`), element(doc, 'dd', String(character.skills[key])));
  return list;
}

/** Presentation owns only drafts and public projections, never a world. */
export function mountCharacterCreation(root: HTMLElement, creation: CharacterCreation, onStarted: (result: StartedGame) => void): () => void {
  const doc = root.ownerDocument, intro = root.querySelector<HTMLElement>('#intro')!;
  const handlers = new AbortController();
  const open = element(doc, 'button', '新游戏 · 创建角色'); open.id = 'new-game'; open.type = 'button'; open.className = 'suggestion';
  root.querySelector('#enter')!.after(open);
  const panel = element(doc, 'section'); panel.id = 'character-creation'; panel.className = 'card creation'; panel.hidden = true;
  panel.setAttribute('aria-labelledby', 'character-title');
  const title = element(doc, 'h2', '你是谁，想要守住什么？'); title.id = 'character-title';
  const notice = element(doc, 'p', characterNotice); notice.className = 'hint'; notice.id = 'character-notice';
  const error = element(doc, 'p'); error.id = 'character-errors'; error.tabIndex = -1; error.setAttribute('role', 'alert');
  const form = element(doc, 'form'); form.id = 'character-form'; form.noValidate = true;
  const hint = element(doc, 'p', '姓名必填，去除首尾空白后 1–40 个字符；年龄 1–120。其他资料可留空，每项最多 240 个字符（按 Unicode 代码点计数），保留换行。');
  hint.className = 'hint'; hint.id = 'character-help'; form.append(hint);
  const grid = element(doc, 'div'); grid.className = 'character-fields'; form.append(grid);
  const controls = new Map<string, HTMLInputElement | HTMLTextAreaElement>();
  function addField(key: string, label: string, numeric: boolean, value: string) {
    const wrapper = element(doc, 'div'), labelNode = element(doc, 'label', label);
    const control = numeric ? element(doc, 'input') : element(doc, 'textarea');
    control.id = `character-${key}`; control.name = key; control.value = value;
    if (numeric) (control as HTMLInputElement).inputMode = 'numeric'; else (control as HTMLTextAreaElement).rows = 2;
    control.setAttribute('aria-describedby', 'character-help character-notice');
    labelNode.htmlFor = control.id; wrapper.append(labelNode, control); grid.append(wrapper); controls.set(key, control);
  }
  for (const [key, label] of characterFields) addField(key, label, key === 'age', creation.read().draft.profile[key]);
  const skillsHint = element(doc, 'p', '初始技能：每项 0–30 的整数，总和不超过 60；默认各 20。背景文字不会覆盖这些数值。');
  skillsHint.className = 'hint'; grid.append(skillsHint);
  for (const [key, label] of characterSkills) addField(key, label, true, creation.read().draft.skills[key]);
  const previewButton = element(doc, 'button', '预览角色'); previewButton.id = 'preview-character'; previewButton.type = 'submit'; previewButton.className = 'primary'; form.append(previewButton);
  const preview = element(doc, 'section'); preview.id = 'character-preview'; preview.hidden = true;
  const summary = element(doc, 'div');
  const start = element(doc, 'button', '确认资料，开始'); start.id = 'start-character'; start.type = 'button'; start.className = 'primary';
  const edit = element(doc, 'button', '返回修改'); edit.id = 'edit-character'; edit.type = 'button';
  preview.append(element(doc, 'h3', '开始前确认'), summary, start, edit);
  const cancel = element(doc, 'button', '取消，返回首页'); cancel.id = 'cancel-character'; cancel.type = 'button';
  panel.append(title, notice, error, form, preview, cancel); intro.after(panel);

  function updateDraft() {
    creation.update({ profile: Object.fromEntries(characterFields.map(([key]) => [key, controls.get(key)!.value])),
      skills: Object.fromEntries(characterSkills.map(([key]) => [key, controls.get(key)!.value])) } as unknown as CharacterDraft);
  }
  function render() {
    const view = creation.read(); error.textContent = view.errors.join(' ');
    form.hidden = view.preview !== null; preview.hidden = view.preview === null;
    if (view.preview) {
      const p = view.preview;
      const stats = element(doc, 'p', `实际起点：${p.locationLabel} · ${p.clockLabel}。初始生命 ${p.stats.hp}、体力 ${p.stats.stamina}、精神 ${p.stats.mental}；饥饿 ${p.stats.hunger}、口渴 ${p.stats.thirst}、疲劳 ${p.stats.fatigue}、感染 ${p.stats.infection}、疼痛 ${p.stats.pain}；体温 ${p.stats.bodyTempC}°C，负重 ${p.stats.carryWeightKg}kg。`);
      summary.replaceChildren(stats, profileDetails(doc, p.character));
    }
  }
  open.addEventListener('click', event => {
    if (event.detail > 1 || creation.read().started) return;
    intro.hidden = true; panel.hidden = false; render(); controls.get('name')!.focus();
  }, { signal: handlers.signal });
  form.addEventListener('input', () => { updateDraft(); error.textContent = ''; }, { signal: handlers.signal });
  form.addEventListener('submit', event => {
    event.preventDefault(); updateDraft(); creation.preview(); render();
    if (creation.read().preview) start.focus(); else error.focus();
  }, { signal: handlers.signal });
  // Enter in a text/number field must not implicitly skip to preview or creation.
  panel.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    if (event.isComposing || event.keyCode === 229 || event.repeat || event.target instanceof HTMLInputElement) event.preventDefault();
  }, { signal: handlers.signal });
  edit.addEventListener('click', () => { creation.edit(); render(); controls.get('name')!.focus(); }, { signal: handlers.signal });
  cancel.addEventListener('click', () => {
    creation.cancel(); panel.hidden = true; intro.hidden = false; open.focus();
  }, { signal: handlers.signal });
  start.addEventListener('click', event => {
    if (event.detail > 1) return;
    const result = creation.start();
    if (!result) { render(); error.focus(); return; }
    try { onStarted(result); panel.hidden = true; }
    catch { error.textContent = '页面未能进入，资料仍在，请再次点击开始。'; error.focus(); }
  }, { signal: handlers.signal });
  return () => { handlers.abort(); panel.remove(); open.remove(); };
}
