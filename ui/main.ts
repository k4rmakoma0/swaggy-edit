import './style.css';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { el, icon, button, badge } from './dom';
import { SourceEditor } from './editor';
import { renderPreview } from './preview';
import { obj, matches, operationKey, previewSectionKeys, nameForFormat, type DocumentSnapshot, type Format, type Mode, type Spec } from './types';

interface Preferences { mode: Mode; theme: 'system' | 'light' | 'dark'; fontSize: number; ratio: number; recent: { path: string; name: string }[] }
const defaults: Preferences = { mode: 'split', theme: 'system', fontSize: 12, ratio: 48, recent: [] };
function loadPreferences(): Preferences {
  try {
    const value = JSON.parse(localStorage.getItem('swaggy.preferences') || '{}');
    return {
      mode: ['view', 'edit', 'split'].includes(value.mode) ? value.mode : defaults.mode,
      theme: ['system', 'light', 'dark'].includes(value.theme) ? value.theme : defaults.theme,
      fontSize: Math.min(22, Math.max(10, Number(value.fontSize) || 12)),
      ratio: Math.min(70, Math.max(28, Number(value.ratio) || 48)),
      recent: Array.isArray(value.recent) ? value.recent.filter((p: { path?: unknown; name?: unknown }) => typeof p?.path === 'string' && typeof p?.name === 'string').slice(0, 8) : [],
    };
  } catch { return { ...defaults }; }
}
const preferences = loadPreferences();
let source = '', savedSource = '', format: Format = 'Yaml', savedFormat: Format = 'Yaml', filename = 'untitled.yaml', path: string | null = null;
let spec: Spec | null = null, selected: string | null = null, query = '', parseError: string | null = null;
const expandedPreviewSections = new Set<string>();
let revision = 0, parseTimer: ReturnType<typeof setTimeout>, toastTimer: ReturnType<typeof setTimeout>;
let replacing = false, busy = false, analysing = false, platformName = 'macos';
const systemTheme = matchMedia('(prefers-color-scheme: dark)');
const shell = el('div', 'shell');
const sidebar = el('aside', 'sidebar'); sidebar.setAttribute('aria-label', 'Explorador de la API');
const drag = el('div', 'sidebar-drag'); drag.dataset.tauriDragRegion = '';
const brand = el('div', 'brand'); const mark = el('div', 'brand-icon'); mark.append(icon('braces', 19));
const brandText = el('div'); brandText.append(el('div', 'brand-name', 'Swaggy'), el('div', 'brand-sub', 'Un espacio para tu API'));
brand.append(mark, brandText);
const docLabel = el('div', 'sidebar-section-label', 'Documento');
const newButton = button('Nueva especificación', 'plus', () => void guarded(() => create(false)), 'icon-button'); docLabel.append(newButton);
const documentCard = el('div', 'document-card'); const docInfo = el('div'); const docName = el('div', 'doc-name', filename); const docDetail = el('div', 'doc-detail', 'YAML · Documento local');
const dirtyDot = el('span', 'dirty-indicator'); dirtyDot.title = 'Cambios sin guardar';
docInfo.append(docName, docDetail); documentCard.append(icon('file', 19), docInfo, dirtyDot);
const searchBox = el('div', 'search-box'); const search = el('input'); search.type = 'search'; search.placeholder = 'Buscar endpoints'; search.setAttribute('aria-label', 'Buscar endpoints');
const searchShortcut = el('kbd', '', '⌘ K'); searchBox.append(icon('search', 13), search, searchShortcut);
const overviewButton = button('Resumen de la API', 'grid', () => select(null), 'nav-overview active');
const navigation = el('nav', 'nav-scroll'); navigation.setAttribute('aria-label', 'Endpoints y schemas');
const sidebarFooter = el('div', 'sidebar-footer');
const themeButton = button('Cambiar apariencia', 'sun', toggleTheme, 'icon-button');
const exampleButton = button('Explorar ejemplo', 'bolt', () => void guarded(() => create(true)), 'example-button');
sidebarFooter.append(exampleButton, themeButton); sidebar.append(drag, brand, docLabel, documentCard, searchBox, overviewButton, navigation, sidebarFooter);
const workspace = el('main', 'workspace');
const toolbar = el('header', 'toolbar'); toolbar.dataset.tauriDragRegion = '';
const toolbarDoc = el('div', 'toolbar-doc'); toolbarDoc.dataset.tauriDragRegion = '';
const toolbarName = el('div', 'toolbar-name', filename); const toolbarSubtitle = el('small', '', 'Especificación OpenAPI'); toolbarName.append(toolbarSubtitle); toolbarDoc.append(icon('file', 16), toolbarName);
const segmented = el('div', 'segmented'); segmented.setAttribute('role', 'group'); segmented.setAttribute('aria-label', 'Modo de trabajo');
const modeButtons = new Map<Mode, HTMLButtonElement>();
for (const [mode, label, glyph] of [['view', 'Visualizar', 'book'], ['edit', 'Editar', 'code'], ['split', 'Mixto', 'split']] as const) {
  const node = button(label, glyph, () => setMode(mode)); node.dataset.mode = mode; node.setAttribute('aria-pressed', String(mode === preferences.mode)); modeButtons.set(mode, node); segmented.append(node);
}
const toolbarActions = el('div', 'toolbar-actions');
const openButton = button('Abrir especificación', 'folder', () => void guarded(() => open()), 'icon-button');
const recentButton = button('Archivos recientes', 'more', () => toggleRecent(), 'icon-button');
const convertButton = button('Convertir a JSON', 'code', () => void rewrite(format === 'Json' ? 'Yaml' : 'Json'), 'save-button conversion-button');
const saveButton = button('Guardar', 'save', () => void exclusive(() => save(false)), 'save-button');
toolbarActions.append(openButton, recentButton, el('span', 'divider'), convertButton, saveButton); toolbar.append(toolbarDoc, segmented, toolbarActions);
const content = el('div', 'content');
const editorPane = el('section', 'editor-pane'); editorPane.setAttribute('aria-label', 'Editor');
const editorToolbar = el('div', 'pane-toolbar'); const editorName = el('span', 'pane-name editor-name', filename); const formatLabel = el('span', 'format-badge', 'YAML');
const optionsButton = button('Opciones del editor', 'more', () => toggleEditorMenu(), 'icon-button');
editorToolbar.append(icon('code'), editorName, dirtyDot.cloneNode(), formatLabel, optionsButton);
const editorHost = el('div', 'editor-host'); editorPane.append(editorToolbar, editorHost);
const resizeHandle = el('div', 'resize-handle'); resizeHandle.tabIndex = 0; resizeHandle.setAttribute('role', 'separator'); resizeHandle.setAttribute('aria-orientation', 'vertical'); resizeHandle.setAttribute('aria-label', 'Ajustar paneles'); resizeHandle.setAttribute('aria-valuemin', '28'); resizeHandle.setAttribute('aria-valuemax', '70');
const previewPane = el('section', 'preview-pane'); previewPane.setAttribute('aria-label', 'Documentación de la API');
const previewToolbar = el('div', 'pane-toolbar preview-toolbar'); const liveLabel = el('span', 'live-label', 'Vista en vivo');
const expansionControls = el('div', 'expansion-controls'); expansionControls.setAttribute('role', 'group'); expansionControls.setAttribute('aria-label', 'Expandir o contraer endpoints y esquemas');
const expandAllButton = button('Expandir todo', 'expand', () => setAllExpanded(true), 'expansion-button');
const collapseAllButton = button('Contraer todo', 'collapse', () => setAllExpanded(false), 'expansion-button');
for (const [node, action] of [[expandAllButton, 'Expandir'], [collapseAllButton, 'Contraer']] as const) {
  node.disabled = true;
  node.setAttribute('aria-label', `${action} todos los endpoints y esquemas`);
  node.title = `${action} todos los endpoints y esquemas del documento, incluidos los que no coinciden con la búsqueda`;
}
expansionControls.append(expandAllButton, collapseAllButton);
previewToolbar.append(icon('book'), el('span', 'pane-name', 'Documentación'), expansionControls, liveLabel);
const stale = el('div', 'stale-notice'); stale.setAttribute('role', 'status');
const previewScroll = el('div', 'preview-scroll'); const previewInner = el('article', 'preview-inner'); previewScroll.append(previewInner); previewPane.append(previewToolbar, stale, previewScroll);
content.append(editorPane, resizeHandle, previewPane);
const diagnostics = el('section', 'diagnostics'); diagnostics.hidden = true; diagnostics.setAttribute('aria-label', 'Problemas del documento');
const statusbar = el('footer', 'statusbar'); const statusButton = button('Analizando documento…', 'check', () => { diagnostics.hidden = !diagnostics.hidden; }, 'status-button'); statusButton.title = 'Sintaxis y estructura básica; no certifica conformidad completa con OpenAPI.';
const statusRight = el('div', 'status-right'); const cursor = el('span', '', 'Ln 1, Col 1'); const encoding = el('span', '', 'UTF-8'); const statusFormat = el('span', '', 'YAML');
statusRight.append(cursor, encoding, statusFormat); statusbar.append(statusButton, statusRight); workspace.append(toolbar, content, diagnostics, statusbar);
const toast = el('div', 'toast'); toast.hidden = true; toast.setAttribute('role', 'status');
const editorMenu = el('div', 'menu-popover'); editorMenu.hidden = true;
const recentMenu = el('div', 'menu-popover recent-menu'); recentMenu.hidden = true;
const dragOverlay = el('div', 'drag-overlay', 'Suelta tu especificación para abrirla'); dragOverlay.hidden = true;
shell.append(sidebar, workspace); document.getElementById('app')!.append(shell, toast, editorMenu, recentMenu, dragOverlay);
const editor = new SourceEditor(editorHost, (value, editorFormat) => {
  if (replacing) return;
  source = value;
  if (format !== editorFormat) { format = editorFormat; updateDocumentName(); }
  updateDocumentState(); queueParse();
}, (line, column) => { cursor.textContent = `Ln ${line}, Col ${column}`; });

function dirty(): boolean { return source !== savedSource || format !== savedFormat; }
function persist(): void { try { localStorage.setItem('swaggy.preferences', JSON.stringify(preferences)); } catch { /* Preferences are optional, never API contents. */ } }
function notice(message: string, error = false): void {
  toast.textContent = message; toast.classList.toggle('error', error); toast.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, error ? 11000 : 3500);
}
function updateDocumentName(): void {
  const originalName = path?.split(/[\\/]/).at(-1) || filename;
  filename = nameForFormat(originalName, format);
}
function updateDocumentState(): void {
  shell.classList.toggle('is-dirty', dirty());
  const language = format === 'Json' ? 'JSON' : 'YAML';
  const conversionLabel = `Convertir a ${format === 'Json' ? 'YAML' : 'JSON'}`;
  convertButton.replaceChildren(icon('code', 14), el('span', '', conversionLabel)); convertButton.title = conversionLabel; convertButton.setAttribute('aria-label', conversionLabel);
  docName.textContent = filename; docName.title = path || filename; docDetail.textContent = `${language} · ${dirty() ? 'Sin guardar' : path ? 'Archivo local' : 'Documento nuevo'}`;
  editorName.textContent = filename; formatLabel.textContent = language; statusFormat.textContent = language;
  toolbarName.replaceChildren(document.createTextNode(filename), toolbarSubtitle);
  void invoke('set_dirty', { dirty: dirty() }).catch(error => notice(String(error), true));
  void getCurrentWindow().setTitle(`${dirty() ? '• ' : ''}${filename} — Swaggy`).catch(() => {});
}
function setMode(mode: Mode): void {
  preferences.mode = mode; content.dataset.mode = mode;
  for (const [key, node] of modeButtons) { node.classList.toggle('active', mode === key); node.setAttribute('aria-pressed', String(mode === key)); }
  liveLabel.textContent = mode === 'view' ? 'Solo lectura' : 'Vista en vivo';
  persist(); editor.view.requestMeasure();
}
function setTheme(): void {
  const dark = preferences.theme === 'dark' || preferences.theme === 'system' && systemTheme.matches;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  themeButton.replaceChildren(icon(dark ? 'sun' : 'moon')); themeButton.title = dark ? 'Usar apariencia clara' : 'Usar apariencia oscura';
  editor.setDark(dark);
  void getCurrentWindow().setTheme(preferences.theme === 'system' ? null : preferences.theme).catch(() => {});
  persist();
}
function toggleTheme(): void { preferences.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; setTheme(); }
function select(key: string | null): void {
  selected = key;
  if (key) expandedPreviewSections.add(key);
  renderNavigation(); renderDocumentation();
  const section = Array.from(previewInner.querySelectorAll<HTMLElement>('[data-preview-key]')).find(section => section.dataset.previewKey === key);
  if (section) {
    // Scroll only the documentation pane, leaving the source editor in place.
    previewScroll.scrollTop += section.getBoundingClientRect().top - previewScroll.getBoundingClientRect().top - 12;
  } else { previewScroll.scrollTop = 0; }
}
function renderNavigation(): void {
  const scroll = navigation.scrollTop; navigation.replaceChildren(); overviewButton.classList.toggle('active', selected === null);
  if (!spec) return;
  const label = el('div', 'sidebar-section-label', 'Endpoints'); label.append(el('span', 'count', String(spec.operations.length))); navigation.append(label);
  const filtered = spec.operations.filter(op => matches(op, query));
  for (const tag of new Set(filtered.map(op => op.tag))) {
    const tagLabel = el('div', 'tag-title'); tagLabel.append(icon('chevron', 11), document.createTextNode(tag)); navigation.append(tagLabel);
    for (const op of filtered.filter(op => op.tag === tag)) {
      const node = button(`${op.method} ${op.path} · ${op.summary}`, null, () => select(operationKey(op)), 'endpoint-nav');
      node.replaceChildren(badge(op.method, `method ${op.method}`), el('span', 'path', op.path)); node.classList.toggle('active', selected === operationKey(op)); navigation.append(node);
    }
  }
  if (!filtered.length && query) navigation.append(el('p', 'tag-title', 'Sin coincidencias'));
  const schemas = obj(obj(spec.root.components).schemas ?? spec.root.definitions);
  if (Object.keys(schemas).length) {
    const label = el('div', 'sidebar-section-label', 'Schemas'); label.append(el('span', 'count', String(Object.keys(schemas).length))); navigation.append(label);
    for (const name of Object.keys(schemas).filter(name => name.toLowerCase().includes(query.toLowerCase()))) {
      const node = button(name, 'braces', () => select(`schema:${name}`), 'schema-nav'); node.classList.toggle('active', selected === `schema:${name}`); navigation.append(node);
    }
  }
  navigation.scrollTop = scroll;
}
function updateExpansionControls(): void {
  const keys = spec ? previewSectionKeys(spec) : [];
  expandAllButton.disabled = !keys.some(key => !expandedPreviewSections.has(key));
  collapseAllButton.disabled = !keys.some(key => expandedPreviewSections.has(key));
}
function setAllExpanded(open: boolean): void {
  if (!spec) return;
  if (open) for (const key of previewSectionKeys(spec)) expandedPreviewSections.add(key);
  else { expandedPreviewSections.clear(); selected = null; }
  renderDocumentation(); renderNavigation();
}
function renderDocumentation(): void {
  const scroll = previewScroll.scrollTop;
  renderPreview(previewInner, spec, query, expandedPreviewSections, (key, open) => {
    if (open) selected = key; else if (selected === key) selected = null;
    renderNavigation(); updateExpansionControls();
  });
  previewScroll.scrollTop = scroll;
  updateExpansionControls();
}
function updateStatus(): void {
  const errors = parseError ? 1 : spec?.diagnostics.filter(d => d.error).length || 0;
  const warnings = spec?.diagnostics.filter(d => !d.error).length || 0;
  const text = analysing ? 'Actualizando documentación…' : errors ? `${errors} ${errors === 1 ? 'error' : 'errores'} en el documento` : warnings ? `${warnings} ${warnings === 1 ? 'aviso' : 'avisos'} · Sin errores básicos` : 'Sin errores básicos';
  statusButton.replaceChildren(icon(errors ? 'alert' : 'check', 11), document.createTextNode(text)); statusButton.classList.toggle('error', errors > 0); statusButton.setAttribute('aria-label', text);
  stale.classList.toggle('visible', !!parseError || analysing);
  stale.textContent = parseError ? 'Corrige la sintaxis para actualizar la vista. Se conserva la última versión analizada.' : analysing ? 'Actualizando documentación…' : '';
  const header = el('div', 'diagnostic-header'); header.append(el('strong', '', 'Problemas'), el('span', 'tag-description', 'Sintaxis y estructura básica'), button('Cerrar problemas', 'close', () => { diagnostics.hidden = true; }, 'icon-button'));
  diagnostics.replaceChildren(header);
  if (parseError) diagnostics.append(el('div', 'diagnostic-row', parseError));
  else for (const d of spec?.diagnostics.slice(0, 100) || []) {
    const row = el('div', 'diagnostic-row'); row.append(el('strong', '', d.error ? 'ERROR' : 'AVISO'), el('code', '', d.location), document.createTextNode(`\n${d.message}`)); diagnostics.append(row);
  }
  diagnostics.append(el('div', 'diagnostic-note', 'Comprobaciones básicas. No sustituye una validación completa de OpenAPI.'));
}
function queueParse(immediate = false): void {
  revision++; const current = revision; clearTimeout(parseTimer); analysing = true; updateStatus();
  parseTimer = setTimeout(async () => {
    try {
      const result = await invoke<Spec>('parse_document', { source, format });
      if (current !== revision) return;
      spec = result; parseError = null;
      if (selected?.startsWith('schema:') && !(selected.slice(7) in obj(obj(spec.root.components).schemas ?? spec.root.definitions))) selected = null;
      else if (selected && !selected.startsWith('schema:') && !spec.operations.some(op => operationKey(op) === selected)) selected = null;
      const keys = new Set(previewSectionKeys(spec));
      for (const key of expandedPreviewSections) if (!keys.has(key)) expandedPreviewSections.delete(key);
      renderNavigation(); renderDocumentation();
    } catch (error) { if (current !== revision) return; parseError = String(error); diagnostics.hidden = false; }
    if (current === revision) { analysing = false; updateStatus(); }
  }, immediate ? 0 : 280);
}
function applyDocument(document: DocumentSnapshot): void {
  replacing = true; source = document.source; savedSource = source; format = document.format; savedFormat = format; filename = document.name; path = document.path;
  editor.replace(source, format, true); replacing = false;
  selected = null; expandedPreviewSections.clear(); query = ''; search.value = ''; spec = null; parseError = null; diagnostics.hidden = true; cursor.textContent = 'Ln 1, Col 1';
  remember(); updateDocumentState(); renderNavigation(); renderDocumentation(); queueParse(true);
}
function remember(): void {
  if (!path) return;
  preferences.recent = [{ path, name: filename }, ...preferences.recent.filter(p => p.path !== path)].slice(0, 8); persist();
}
async function save(saveAs: boolean): Promise<boolean> {
  try {
    const result = await invoke<DocumentSnapshot | null>('save_document', { source, format, saveAs });
    if (!result) return false;
    savedSource = result.source; savedFormat = result.format; path = result.path; filename = result.name; remember(); updateDocumentState(); notice('Especificación guardada'); return true;
  } catch (error) { notice(String(error), true); return false; }
}
async function open(filePath: string | null = null): Promise<void> {
  const result = await invoke<DocumentSnapshot | null>('open_document', { path: filePath });
  if (result) applyDocument(result);
}
async function create(example: boolean): Promise<void> { applyDocument(await invoke<DocumentSnapshot>('new_document', { example })); }
function choose(title: string, message: string, choices: { label: string; value: string; className?: string }[]): Promise<string> {
  return new Promise(resolve => {
    const dialog = el('dialog'); const mark = el('div', 'dialog-icon'); mark.append(icon('file', 24));
    dialog.append(mark, el('h2', '', title), el('p', '', message));
    const actions = el('div', 'dialog-actions');
    const finish = (value: string) => { dialog.close(); dialog.remove(); resolve(value); };
    for (const choice of choices) actions.append(button(choice.label, null, () => finish(choice.value), choice.className || ''));
    dialog.append(actions); dialog.addEventListener('cancel', event => { event.preventDefault(); finish('cancel'); });
    document.body.append(dialog); dialog.showModal();
    (actions.lastElementChild as HTMLButtonElement)?.focus();
  });
}
async function exclusive(action: () => Promise<unknown>): Promise<void> {
  if (busy) return; busy = true; [openButton, saveButton, convertButton, newButton, exampleButton].forEach(b => { b.disabled = true; });
  try { await action(); } catch (error) { notice(String(error), true); }
  finally { busy = false; [openButton, saveButton, convertButton, newButton, exampleButton].forEach(b => { b.disabled = false; }); }
}
async function guarded(action: () => Promise<unknown>): Promise<void> {
  await exclusive(async () => {
    if (dirty()) {
      const choice = await choose('¿Guardar tus cambios?', `La especificación ${filename} tiene cambios sin guardar.`, [
        { label: 'Cancelar', value: 'cancel' }, { label: 'Descartar', value: 'discard', className: 'destructive' }, { label: 'Guardar', value: 'save', className: 'primary' },
      ]);
      if (choice === 'cancel' || choice === 'save' && !await save(false)) return;
    }
    await action();
  });
}
async function convert(target: Format): Promise<void> {
  if (busy) return;
  if (target === format) { notice(`El documento ya está en ${target === 'Json' ? 'JSON' : 'YAML'}`); return; }
  await rewrite(target);
}
async function rewrite(target: Format): Promise<void> {
  editorMenu.hidden = true;
  await exclusive(async () => {
    const originalFormat = format;
    const isConversion = target !== originalFormat;
    const targetLabel = target === 'Json' ? 'JSON' : 'YAML';
    const message = originalFormat === 'Yaml'
      ? 'Se conservarán los datos de la API. Los comentarios, las anclas YAML y el formato original se reemplazarán.'
      : 'Se conservarán los datos de la API y se reemplazará el formato de escritura del documento.';
    const choice = await choose(isConversion ? `Convertir a ${targetLabel}` : 'Formatear especificación', message, [{ label: 'Cancelar', value: 'cancel' }, { label: 'Continuar', value: 'continue', className: 'primary' }]);
    if (choice !== 'continue') return;
    const originalSource = source;
    const result = await invoke<string>('rewrite_document', { source: originalSource, format: originalFormat, target });
    if (source !== originalSource || format !== originalFormat) { notice('El documento cambió durante la conversión. Vuelve a intentarlo.', true); return; }
    format = target; source = result;
    replacing = true; editor.replace(source, format); replacing = false;
    updateDocumentName();
    updateDocumentState(); queueParse(true); notice(isConversion ? `Convertido a ${targetLabel}. Guarda para crear el archivo.` : 'Documento formateado');
  });
}
function toggleEditorMenu(): void {
  const wasHidden = editorMenu.hidden; closeMenus(); if (!wasHidden) return;
  editorMenu.replaceChildren(button('Formatear documento', 'format', () => void rewrite(format)), button(`Convertir a ${format === 'Json' ? 'YAML' : 'JSON'}`, 'code', () => void rewrite(format === 'Json' ? 'Yaml' : 'Json')), el('div', 'menu-divider'));
  const label = el('label', '', 'Tamaño de texto'); const size = el('input'); size.type = 'number'; size.min = '10'; size.max = '22'; size.value = String(preferences.fontSize); size.setAttribute('aria-label', 'Tamaño de texto del editor');
  size.addEventListener('change', () => { preferences.fontSize = Math.min(22, Math.max(10, Number(size.value) || 12)); editorHost.style.setProperty('--code-size', `${preferences.fontSize}px`); persist(); editor.view.requestMeasure(); }); label.append(size); editorMenu.append(label);
  const rect = optionsButton.getBoundingClientRect(); editorMenu.style.left = `${Math.min(innerWidth - 230, Math.max(10, rect.right - 220))}px`; editorMenu.style.top = `${rect.bottom + 6}px`; editorMenu.hidden = false;
}
function toggleRecent(): void {
  const wasHidden = recentMenu.hidden; closeMenus(); if (!wasHidden) return;
  recentMenu.replaceChildren();
  for (const file of preferences.recent) { const node = button(file.name, 'file', () => { closeMenus(); void guarded(() => open(file.path)); }); node.title = file.path; recentMenu.append(node); }
  if (!preferences.recent.length) recentMenu.append(el('div', 'diagnostic-note', 'Tus archivos recientes aparecerán aquí.'));
  const rect = recentButton.getBoundingClientRect(); recentMenu.style.left = `${Math.max(10, rect.right - 220)}px`; recentMenu.style.top = `${rect.bottom + 6}px`; recentMenu.hidden = false;
}
function closeMenus(): void { editorMenu.hidden = true; recentMenu.hidden = true; }
function setRatio(ratio: number): void { preferences.ratio = Math.min(70, Math.max(28, ratio)); document.documentElement.style.setProperty('--editor-ratio', `${preferences.ratio}%`); resizeHandle.setAttribute('aria-valuenow', String(Math.round(preferences.ratio))); editor.view.requestMeasure(); }
resizeHandle.addEventListener('pointerdown', event => {
  resizeHandle.setPointerCapture(event.pointerId); document.body.style.cursor = 'col-resize';
  const move = (event: PointerEvent) => { const rect = content.getBoundingClientRect(); setRatio((event.clientX - rect.left) / rect.width * 100); };
  const done = () => { resizeHandle.removeEventListener('pointermove', move); resizeHandle.removeEventListener('pointerup', done); resizeHandle.removeEventListener('pointercancel', done); document.body.style.cursor = ''; persist(); };
  resizeHandle.addEventListener('pointermove', move); resizeHandle.addEventListener('pointerup', done); resizeHandle.addEventListener('pointercancel', done);
});
resizeHandle.addEventListener('keydown', event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setRatio(preferences.ratio + (event.key === 'ArrowLeft' ? -2 : 2)); persist(); } });
search.addEventListener('input', () => { query = search.value; renderNavigation(); renderDocumentation(); });
document.addEventListener('pointerdown', event => { if (!(event.target instanceof Node)) return; if (!editorMenu.contains(event.target) && !optionsButton.contains(event.target)) editorMenu.hidden = true; if (!recentMenu.contains(event.target) && !recentButton.contains(event.target)) recentMenu.hidden = true; });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeMenus();
  if (!(event.metaKey || event.ctrlKey) || document.querySelector('dialog[open]')) return;
  if (event.key.toLowerCase() === 'k') { event.preventDefault(); search.focus(); search.select(); }
  if (['1', '2', '3'].includes(event.key)) { event.preventDefault(); setMode(({ '1': 'view', '2': 'edit', '3': 'split' } as Record<string, Mode>)[event.key]); }
});
systemTheme.addEventListener('change', () => { if (preferences.theme === 'system') setTheme(); });
async function initialize(): Promise<void> {
  platformName = await invoke<string>('platform');
  document.documentElement.className = `platform-${platformName}`; searchShortcut.textContent = platformName === 'macos' ? '⌘ K' : 'Ctrl K';
  setTheme(); setMode(preferences.mode); setRatio(preferences.ratio); editorHost.style.setProperty('--code-size', `${preferences.fontSize}px`);
  await listen<string>('menu-action', ({ payload: action }) => {
    if (action === 'new') void guarded(() => create(false));
    else if (action === 'open') void guarded(() => open());
    else if (action === 'save') void exclusive(() => save(false));
    else if (action === 'convert-json') void convert('Json');
    else if (action === 'convert-yaml') void convert('Yaml');
    else if (action === 'save-as') void exclusive(() => save(true));
    else if (action === 'example') void guarded(() => create(true));
    else if (['view', 'edit', 'split'].includes(action)) setMode(action as Mode);
    else if (action === 'theme') toggleTheme();
    else if (action === 'quit') void guarded(() => invoke('quit_app'));
  });
  await listen('request-close', () => void guarded(() => invoke('quit_app')));
  await getCurrentWindow().onDragDropEvent(({ payload }) => {
    dragOverlay.hidden = payload.type !== 'enter' && payload.type !== 'over';
    if (payload.type === 'drop' && payload.paths[0]) void guarded(() => open(payload.paths[0]));
  });
  applyDocument(await invoke<DocumentSnapshot>('current_document'));
}
void initialize().catch(error => { notice(`No se pudo iniciar Swaggy: ${String(error)}`, true); renderDocumentation(); });
