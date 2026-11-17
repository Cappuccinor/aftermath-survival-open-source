import type { ManualPersistenceClient, StartedGame, ManualSlotId } from '../application/ports';

/** Renders only filtered metadata and commands supplied by the trusted application. */
export function mountPersistence(root: HTMLElement, client: ManualPersistenceClient, loaded: (game: StartedGame) => void): () => void {
  const doc = root.ownerDocument, panel = doc.createElement('section'); panel.className = 'card persistence'; panel.id = 'persistence';
  const heading = doc.createElement('h2'); heading.textContent = '本机存档';
  const label = doc.createElement('label'); label.htmlFor = 'save-slot-selector'; label.textContent = '目标存档槽（选择后不会自动读取）';
  const select = doc.createElement('select'); select.id = 'save-slot-selector';
  const list = doc.createElement('ul'); list.id = 'save-slots-list'; list.className = 'hint';
  const current = doc.createElement('p'); current.id = 'save-current'; current.className = 'hint';
  const metadata = doc.createElement('p'); metadata.id = 'save-slot'; metadata.className = 'hint';
  const status = doc.createElement('p'); status.id = 'save-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const autoStatus = doc.createElement('p'); autoStatus.id = 'autosave-status'; autoStatus.setAttribute('role', 'status'); autoStatus.setAttribute('aria-live', 'polite');
  const exportStatus = doc.createElement('p'); exportStatus.id = 'export-status'; exportStatus.setAttribute('role', 'status'); exportStatus.setAttribute('aria-live', 'polite');
  const importStatus = doc.createElement('p'); importStatus.id = 'import-status'; importStatus.setAttribute('role', 'status'); importStatus.setAttribute('aria-live', 'polite');
  const recoveryStatus = doc.createElement('p'); recoveryStatus.id = 'recovery-status'; recoveryStatus.setAttribute('role', 'status'); recoveryStatus.setAttribute('aria-live', 'polite');
  const migrationStatus=doc.createElement('p');migrationStatus.id='migration-status';migrationStatus.setAttribute('role','status');migrationStatus.setAttribute('aria-live','polite');
  const originalsStatus=doc.createElement('p');originalsStatus.id='originals-status';originalsStatus.setAttribute('role','status');originalsStatus.setAttribute('aria-live','polite');
  const originalLabel=doc.createElement('label');originalLabel.htmlFor='original-selector';originalLabel.textContent='原件（只下载，不预览世界内容）';
  const originalSelect=doc.createElement('select');originalSelect.id='original-selector';
  const fileLabel = doc.createElement('label'); fileLabel.htmlFor = 'import-file'; fileLabel.textContent = '选择存档文件（有效 v1/v2，最多 16 MiB；导入或替换前需确认）';
  const file = doc.createElement('input'); file.type = 'file'; file.id = 'import-file'; file.accept = '.json'; file.multiple = false;
  const controls = doc.createElement('div'); controls.className = 'save-controls';
  function button(id: string, label: string) { const b = doc.createElement('button'); b.type = 'button'; b.id = id; b.textContent = label; b.className = 'suggestion'; controls.append(b); return b; }
  const save = button('manual-save', '手动保存'), load = button('manual-load', '读取存档');
  const refresh = button('refresh-saves', '刷新存档列表');
  const migrationCheck=button('migration-check','检查 v1 升级'),migrationConfirm=button('migration-confirm','确认保留原件并升级'),migrationCancel=button('migration-cancel','取消升级');
  const originalsList=button('originals-list','列出原件'),originalDownload=button('original-download','下载所选原件');
  const recoveryCheck = button('recovery-check', '检查上一备份'), recoveryConfirm = button('recovery-confirm', '确认恢复上一备份'), recoveryCancel = button('recovery-cancel', '取消恢复');
  const exportSave = button('export-save', '导出存档');
  const enable = button('enable-autosave', '开启自动保存'), disable = button('disable-autosave', '关闭自动保存');
  const importConfirm = button('import-confirm', '确认导入'), importCancel = button('import-cancel', '取消导入');
  const importReplace = button('import-replace-confirm', '确认替换');
  const confirm = button('confirm-persistence', '确认'), cancel = button('cancel-persistence', '取消');
  const hint = doc.createElement('p'); hint.className = 'hint'; hint.textContent = '三个存档槽分别保存。选择槽不会改变当前世界或自动保存目标。自动保存默认关闭，先手动保存或主动读档，再明确开启；重开页面需重新开启。请等待保存完成再退出，未保存的变化会丢失。可下载所选槽上次保存的进度，不含未保存变化；损坏或未来版本文本可备份原件。文件包含完整世界，游戏中不预览隐藏事实。有效 v1/v2 文件可导入空槽，或经单独确认替换健康槽；替换时原存档保留为上一备份，当前游戏不切换。之后需主动读取。有效上一备份可单独检查并确认恢复，之后需主动读取。仅部分已识别损坏可恢复。v2 当前档的健康 v1 上一备份可经明确确认转换为 v2 并恢复旧进度，后续事件不在旧进度中；两份原文永久保留，需要额外空间，之后另行读取。其他跨版组合不覆盖，可列出原件分别下载。v1 可经检查和明确确认升级为 v2，永久保留当前与上一备份原文，需要额外空间；成功后另行读取。旧程序只能导出 v2 原文，不能继续新关系。普通保存/文件替换禁止跨版本覆盖，未知或未来格式不覆盖；清理浏览器数据会丢失本机存档。';
  panel.append(heading, label, select, list, metadata, current, controls, fileLabel, file, importStatus, recoveryStatus, autoStatus, status, exportStatus, hint); root.append(panel);
  recoveryStatus.after(migrationStatus,originalsStatus,originalLabel,originalSelect);
  const events = new AbortController();
  async function receive(result: Promise<StartedGame | null>) { const game = await result; if (game && !events.signal.aborted) loaded(game); }
  for (const b of [save, load, refresh, exportSave, enable, disable, confirm, cancel, importConfirm, importReplace, importCancel, recoveryCheck, recoveryConfirm, recoveryCancel,migrationCheck,migrationConfirm,migrationCancel,originalsList,originalDownload]) b.addEventListener('keydown', e => { if (e.repeat && (e.key === 'Enter' || e.key === ' ')) e.preventDefault(); }, { signal: events.signal });
  migrationCheck.addEventListener('click',e=>{if(e.detail<=1)void client.checkMigration?.();},{signal:events.signal});
  migrationConfirm.addEventListener('click',e=>{if(e.detail<=1)void client.confirmMigration?.();},{signal:events.signal});
  migrationCancel.addEventListener('click',e=>{if(e.detail<=1)client.cancelMigration?.();},{signal:events.signal});
  originalsList.addEventListener('click',e=>{if(e.detail<=1)void client.listOriginals?.();},{signal:events.signal});
  originalDownload.addEventListener('click',e=>{if(e.detail<=1)void client.exportOriginal?.(originalSelect.value);},{signal:events.signal});
  recoveryCheck.addEventListener('click', e => { if (e.detail <= 1) void client.checkPrevious(); }, { signal: events.signal });
  recoveryConfirm.addEventListener('click', e => { if (e.detail <= 1) void client.confirmRecovery(); }, { signal: events.signal });
  recoveryCancel.addEventListener('click', e => { if (e.detail <= 1) client.cancelRecovery(); }, { signal: events.signal });
  file.addEventListener('change', () => { const selected = file.files?.[0]; file.value = ''; if (selected) void client.prepareImport(selected); }, { signal: events.signal });
  file.addEventListener('cancel', () => client.cancelImport(), { signal: events.signal });
  importConfirm.addEventListener('click', e => { if (e.detail <= 1) void client.confirmImport(); }, { signal: events.signal });
  importReplace.addEventListener('click', e => { if (e.detail <= 1) void client.confirmImport(); }, { signal: events.signal });
  importCancel.addEventListener('click', e => { if (e.detail <= 1) client.cancelImport(); }, { signal: events.signal });
  exportSave.addEventListener('click', e => { if (e.detail <= 1) void client.exportSave(); }, { signal: events.signal });
  enable.addEventListener('click', e => { if (e.detail <= 1) void client.enableAutosave(); }, { signal: events.signal });
  disable.addEventListener('click', e => { if (e.detail <= 1) client.disableAutosave(); }, { signal: events.signal });
  select.addEventListener('change', () => client.select(select.value as ManualSlotId), { signal: events.signal });
  refresh.addEventListener('click', e => { if (e.detail <= 1) void client.refresh(); }, { signal: events.signal });
  save.addEventListener('click', e => { if (e.detail <= 1) void client.save(); }, { signal: events.signal });
  load.addEventListener('click', e => { if (e.detail <= 1) void receive(client.load()); }, { signal: events.signal });
  confirm.addEventListener('click', e => { if (e.detail <= 1) void receive(client.confirm()); }, { signal: events.signal });
  cancel.addEventListener('click', e => { if (e.detail <= 1) client.cancel(); }, { signal: events.signal });
  const stop = client.subscribe(view => {
    migrationStatus.textContent=view.migration?.message??'';migrationStatus.dataset.phase=view.migration?.phase??'idle';
    migrationCheck.hidden=!client.checkMigration;migrationCheck.disabled=!view.canCheckMigration;
    migrationConfirm.hidden=view.migration?.phase!=='confirm';migrationConfirm.disabled=!view.canConfirmMigration;
    migrationConfirm.textContent=`确认保留存档槽 ${view.migration?.slotId?.slice(-1)??''} 原件并升级`;
    migrationCancel.hidden=!view.canCancelMigration;migrationCancel.disabled=!view.canCancelMigration;
    originalsStatus.textContent=view.originals?.message??'';originalsStatus.dataset.phase=view.originals?.phase??'idle';
    originalsList.hidden=!client.listOriginals;originalsList.disabled=!view.canListOriginals;
    const chosenOriginal=originalSelect.value;originalSelect.replaceChildren(...(view.originals?.entries??[]).map(item=>{const o=doc.createElement('option');o.value=item.id;o.textContent=item.label;return o;}));
    if([...originalSelect.options].some(o=>o.value===chosenOriginal))originalSelect.value=chosenOriginal;
    originalSelect.disabled=!view.canExportOriginal||!originalSelect.options.length;
    originalDownload.disabled=originalSelect.disabled;originalDownload.hidden=originalLabel.hidden=originalSelect.hidden=!client.exportOriginal;
    recoveryStatus.textContent = view.recovery.message; recoveryStatus.dataset.phase = view.recovery.phase;
    recoveryCheck.disabled = !view.canCheckPrevious;
    recoveryConfirm.hidden = view.recovery.phase !== 'confirm'; recoveryConfirm.disabled = !view.canConfirmRecovery;
    recoveryConfirm.textContent = view.recovery.conversion === 'v1-to-v2'
      ? '确认转换为 v2 并恢复存档槽 ' + (view.recovery.slotId?.slice(-1) ?? '') + ' 的旧进度'
      : '确认恢复存档槽 ' + (view.recovery.slotId?.slice(-1) ?? '') + ' 的上一备份';
    recoveryCancel.hidden = !view.canCancelRecovery; recoveryCancel.disabled = !view.canCancelRecovery;
    importStatus.textContent = view.import.message; importStatus.dataset.phase = view.import.phase;
    file.disabled = !view.canImport;
    importConfirm.hidden = view.import.phase !== 'confirm' || view.import.kind === 'replace'; importConfirm.disabled = !view.canConfirmImport;
    importConfirm.textContent = '确认导入存档槽 ' + (view.import.slotId?.slice(-1) ?? '');
    importReplace.hidden = view.import.phase !== 'confirm' || view.import.kind !== 'replace'; importReplace.disabled = !view.canConfirmImport;
    importReplace.textContent = '确认替换存档槽 ' + (view.import.slotId?.slice(-1) ?? '');
    importCancel.hidden = !view.canCancelImport; importCancel.disabled = !view.canCancelImport;
    status.textContent = view.message; status.dataset.phase = view.phase; metadata.textContent = view.slotDescription;
    autoStatus.textContent = view.autosave.message; autoStatus.dataset.mode = view.autosave.mode;
    exportStatus.textContent = view.export.message; exportStatus.dataset.phase = view.export.phase;
    exportSave.textContent = `导出${view.slots.find(slot => slot.id === view.selectedSlot)!.label}已保存的存档`;
    exportSave.disabled = !view.canExport;
    enable.textContent = `开启自动保存到${view.slots.find(slot => slot.id === view.selectedSlot)!.label}`;
    enable.disabled = !view.canEnableAutosave; disable.disabled = !view.canDisableAutosave;
    if (!select.options.length) for (const slot of view.slots) { const option = doc.createElement('option'); option.value = slot.id; option.textContent = slot.label; select.append(option); }
    select.value = view.selectedSlot; select.disabled = !view.canSelect; refresh.disabled = !view.canRefresh;
    list.replaceChildren(...view.slots.map(slot => { const li = doc.createElement('li'); li.textContent = slot.description; return li; }));
    current.textContent = view.currentDescription;
    save.disabled = !view.canSave; load.disabled = !view.canLoad; confirm.hidden = cancel.hidden = view.confirmation === null;
    confirm.disabled = cancel.disabled = view.phase !== 'confirm';
    confirm.textContent = view.confirmation === 'save' ? `确认覆盖${view.confirmationLabel ?? ''}` : `确认读取${view.confirmationLabel ?? ''}并丢弃未保存变化`;
    panel.setAttribute('aria-busy', String(view.busy && !view.confirmation && view.import.phase !== 'confirm' && view.recovery.phase !== 'confirm' && view.migration?.phase!=='confirm'));
    for (const selector of ['#new-game', '#enter', '#start-character']) {
      const control = root.querySelector<HTMLButtonElement>(selector); if (control) control.disabled = view.busy;
    }
  });
  void client.refresh();
  return () => { events.abort(); stop(); panel.remove(); };
}
