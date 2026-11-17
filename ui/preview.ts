import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { el, icon, button, badge, copyText } from './dom';
import { obj, arr, str, matches, resolve, operationKey, type Json, type Spec, type Operation, type ObjectValue } from './types';

function markdown(source: string): HTMLElement {
  const node = el('div', 'markdown');
  // Specifications are untrusted input. Images and active/embedded content are
  // excluded so opening a local spec cannot load remote resources.
  node.innerHTML = DOMPurify.sanitize(marked.parse(source, { async: false }), {
    FORBID_TAGS: ['img', 'style', 'iframe', 'video', 'audio', 'object', 'form', 'input'],
    FORBID_ATTR: ['style', 'src', 'srcset', 'href', 'action'],
  });
  return node;
}
function description(value: ObjectValue, parent: HTMLElement): void { if (str(value.description)) parent.append(markdown(str(value.description))); }
function heading(parent: HTMLElement, title: string, count?: number, trailing?: string): void {
  const section = el('div', 'section-heading'); section.append(el('h2', '', title));
  if (count !== undefined) section.append(el('span', 'count', String(count)));
  if (trailing) section.append(el('span', 'trailing', trailing));
  parent.append(section);
}
function jsonDetails(title: string, value: Json, parent: HTMLElement): void {
  const details = el('details', 'json-details'); details.append(el('summary', '', title));
  // JSON can be large: serialize only when the user expands it.
  details.addEventListener('toggle', () => {
    if (!details.open || details.querySelector('pre')) return;
    const source = JSON.stringify(value, null, 2);
    const copy = button('Copiar JSON', 'copy', () => void copyText(source, copy), 'icon-button');
    details.append(copy, el('pre', '', source));
  });
  parent.append(details);
}
function schemaType(input: Json): string {
  const value = obj(input);
  if (typeof input === 'boolean') return input ? 'any' : 'never';
  if (typeof value.$ref === 'string') return str(value.$ref).split('/').at(-1) || '$ref';
  const kind = Array.isArray(value.type) ? value.type.join(' | ') : str(value.type);
  if (kind === 'array') return `${schemaType(value.items ?? {}) || 'any'}[]`;
  if (kind) return kind;
  if (value.properties) return 'object';
  if (value.oneOf) return 'oneOf';
  if (value.allOf) return 'allOf';
  if (value.anyOf) return 'anyOf';
  return 'any';
}
function schema(input: Json, spec: Spec, parent: HTMLElement, depth = 0): void {
  if (depth > 7) { parent.append(el('p', 'type-label', 'Más niveles disponibles en la definición JSON.')); return; }
  const resolved = resolve(spec.root, input);
  if (resolved.error) { parent.append(el('p', 'type-label', resolved.error)); jsonDetails('Definición de la referencia', input, parent); return; }
  const value = obj(resolved.value);
  const type = el('div', 'type-label', schemaType(input)); parent.append(type);
  description(value, parent);
  const properties = obj(value.properties);
  if (Object.keys(properties).length) {
    const table = el('table', 'schema-table');
    const head = el('thead'); const row = el('tr');
    for (const name of ['Propiedad', 'Tipo']) row.append(el('th', '', name));
    head.append(row); table.append(head); const body = el('tbody');
    for (const [name, property] of Object.entries(properties)) {
      const row = el('tr'); const key = el('td'); const typeCell = el('td', 'type-label', schemaType(property));
      const label = el('code', '', name); key.append(label);
      if (arr(value.required).includes(name)) label.append(el('span', 'req', '*'));
      if (str(obj(property).description)) key.append(el('div', 'property-desc', str(obj(property).description)));
      const constraints = ['format', 'enum', 'default', 'example', 'minimum', 'maximum', 'minLength', 'maxLength', 'pattern', 'nullable'];
      const present = constraints.filter(key => obj(property)[key] !== undefined);
      if (present.length) key.append(el('div', 'property-desc', present.map(key => `${key}: ${JSON.stringify(obj(property)[key])}`).join(' · ')));
      if (Object.keys(obj(property)).some(k => ['properties', '$ref', 'items', 'oneOf', 'allOf', 'anyOf'].includes(k))) {
        const detail = el('details', 'json-details'); detail.append(el('summary', '', 'Ver schema'));
        detail.addEventListener('toggle', () => { if (detail.open && detail.children.length === 1) schema(property, spec, detail, depth + 1); });
        key.append(detail);
      }
      row.append(key, typeCell); body.append(row);
    }
    table.append(body); parent.append(table);
  }
  if (value.items !== undefined) {
    const detail = el('details', 'json-details'); detail.append(el('summary', '', 'Elementos del arreglo'));
    detail.addEventListener('toggle', () => { if (detail.open && detail.children.length === 1) schema(value.items, spec, detail, depth + 1); }); parent.append(detail);
  }
  for (const kind of ['allOf', 'oneOf', 'anyOf']) {
    if (!Array.isArray(value[kind])) continue;
    const detail = el('details', 'json-details'); detail.append(el('summary', '', `${kind} · ${arr(value[kind]).length} schemas`));
    detail.addEventListener('toggle', () => { if (detail.open && detail.children.length === 1) arr(value[kind]).forEach(part => schema(part, spec, detail, depth + 1)); }); parent.append(detail);
  }
  jsonDetails('Definición JSON completa', input, parent);
}
function content(value: Json | undefined, spec: Spec, parent: HTMLElement): void {
  for (const [mediaType, input] of Object.entries(obj(value))) {
    const media = obj(input); parent.append(el('div', 'media-label', mediaType));
    if (media.schema !== undefined) schema(media.schema, spec, parent);
    for (const [key, title] of [['example', 'Ejemplo'], ['examples', 'Ejemplos'], ['encoding', 'Codificación']]) {
      if (media[key] !== undefined) jsonDetails(title, media[key], parent);
    }
  }
}
function operationDetails(parent: HTMLElement, operation: Operation, spec: Spec): void {
  if (operation.value.deprecated) parent.append(badge('Obsoleto'));
  if (str(operation.value.operationId)) parent.append(el('div', 'operation-id mono', str(operation.value.operationId)));
  description(operation.value, parent);
  const security = operation.value.security ?? spec.root.security;
  if (security !== undefined && arr(security).length) { heading(parent, 'Autenticación'); jsonDetails('Requisitos de seguridad', security, parent); }
  heading(parent, 'Parámetros', operation.parameters.length);
  if (!operation.parameters.length) parent.append(el('p', 'tag-description', 'Esta operación no requiere parámetros.'));
  for (const parameter of operation.parameters) {
    const resolved = resolve(spec.root, parameter); const value = obj(resolved.value); const card = el('div', 'parameter-card');
    if (resolved.error) { card.append(el('p', 'type-label', resolved.error)); parent.append(card); continue; }
    const header = el('div', 'parameter-header'); header.append(el('code', '', str(value.name)), badge(str(value.in)));
    if (value.required) header.append(el('span', 'required', 'obligatorio'));
    card.append(header); description(value, card);
    if (value.schema !== undefined) schema(value.schema, spec, card);
    else if (value.type !== undefined) card.append(el('div', 'type-label', schemaType(value)));
    if (value.content) content(value.content, spec, card);
    jsonDetails('Definición del parámetro', value, card); parent.append(card);
  }
  if (operation.value.requestBody !== undefined) {
    heading(parent, 'Cuerpo de la solicitud'); const body = resolve(spec.root, operation.value.requestBody);
    const card = el('div', 'parameter-card');
    if (body.error) card.append(el('p', 'type-label', body.error));
    else { description(obj(body.value), card); if (obj(body.value).required) card.append(el('span', 'required', 'Obligatorio')); content(obj(body.value).content, spec, card); }
    parent.append(card);
  }
  const responses = Object.entries(obj(operation.value.responses)).filter(([key]) => !key.startsWith('x-'));
  heading(parent, 'Respuestas', responses.length);
  for (const [status, input] of responses) {
    const resolved = resolve(spec.root, input); const value = obj(resolved.value); const card = el('div', 'parameter-card');
    const header = el('div', 'response-header'); header.append(el('span', `response-status ${status.startsWith('2') ? '' : 'error'}`, status));
    header.append(el('span', 'op-summary', str(value.description))); card.append(header);
    if (resolved.error) card.append(el('p', 'type-label', resolved.error));
    content(value.content, spec, card);
    if (value.schema !== undefined) schema(value.schema, spec, card);
    for (const [key, title] of [['headers', 'Cabeceras'], ['examples', 'Ejemplos'], ['links', 'Enlaces']]) if (value[key] !== undefined) jsonDetails(title, value[key], card);
    parent.append(card);
  }
  if (operation.value.callbacks) { heading(parent, 'Callbacks'); jsonDetails('Definiciones de callbacks', operation.value.callbacks, parent); }
  heading(parent, 'Definición original'); jsonDetails('Ver todos los campos de la operación', operation.value, parent);
}
type ExpansionHandler = (key: string, open: boolean) => void;

function accordion(key: string, summary: HTMLElement, expanded: Set<string>, onExpansion: ExpansionHandler, renderBody: (body: HTMLElement) => void): HTMLDetailsElement {
  const details = el('details', 'doc-accordion');
  details.dataset.previewKey = key;
  details.append(summary);
  details.open = expanded.has(key);
  let rendered = false;
  const ensureContent = () => {
    if (rendered) return;
    rendered = true;
    const body = el('div', 'accordion-body');
    renderBody(body);
    details.append(body);
  };
  if (details.open) ensureContent();
  details.addEventListener('toggle', () => {
    // Ignore queued events from a preview replaced by a live document update.
    if (!details.isConnected) return;
    if (details.open) ensureContent();
    if (details.open === expanded.has(key)) return;
    if (details.open) expanded.add(key); else expanded.delete(key);
    onExpansion(key, details.open);
  });
  return details;
}

function overview(parent: HTMLElement, spec: Spec, query: string, expanded: Set<string>, onExpansion: ExpansionHandler): void {
  const info = obj(spec.root.info); const eyebrow = el('div', 'eyebrow');
  eyebrow.append(badge(spec.root.swagger === '2.0' ? 'SWAGGER 2.0' : `OPENAPI ${str(spec.root.openapi)}`, 'openapi'), badge(`v${str(info.version) || '—'}`, 'version'));
  parent.append(eyebrow, el('h1', '', str(info.title) || 'Untitled API')); description(info, parent);
  const stats = el('div', 'api-stats');
  for (const [name, value] of [['bolt', `${spec.operations.length} endpoints`], ['braces', `${Object.keys(obj(obj(spec.root.components).schemas ?? spec.root.definitions)).length} schemas`], ['file', str(obj(info.license).name) || 'Sin licencia']]) {
    const stat = el('span'); stat.append(icon(name as 'bolt' | 'braces' | 'file'), document.createTextNode(value)); stats.append(stat);
  }
  parent.append(stats);
  let servers = arr(spec.root.servers);
  if (!servers.length) {
    const host = str(spec.root.host); const scheme = str(arr(spec.root.schemes)[0]) || 'https';
    servers = [{ url: host ? `${scheme}://${host}${str(spec.root.basePath)}` : '/', description: host ? 'Servidor' : 'Servidor por defecto' }];
  }
  for (const input of servers) {
    const value = obj(input); const card = el('section', 'server-card'); const header = el('header'); header.append(icon('globe'), document.createTextNode('Servidor'));
    const line = el('div', 'server-line'); const url = str(value.url); line.append(el('code', '', url));
    if (str(value.description)) line.append(badge(str(value.description)));
    const copy = button('Copiar URL', 'copy', () => void copyText(url, copy), 'icon-button'); line.append(copy); card.append(header, line);
    if (value.variables) jsonDetails('Variables del servidor', value.variables, card);
    parent.append(card);
  }
  const filtered = spec.operations.filter(op => matches(op, query));
  heading(parent, 'Endpoints', filtered.length, 'Expande para ver los detalles');
  const tagDescriptions = new Map(arr(spec.root.tags).map(tag => [str(obj(tag).name), str(obj(tag).description)]));
  let lastTag = '';
  for (const tag of new Set(filtered.map(op => op.tag))) {
    if (lastTag || tag !== 'General') parent.append(el('div', 'tag-description', `${tag}${tagDescriptions.get(tag) ? ` · ${tagDescriptions.get(tag)}` : ''}`));
    lastTag = tag; const list = el('div', 'operation-list');
    for (const op of filtered.filter(op => op.tag === tag)) {
      const card = el('summary', 'operation-card');
      card.append(badge(op.method, `method ${op.method}`));
      const info = el('div', 'op-info'); info.append(el('code', '', op.path));
      if (op.summary) info.append(el('div', 'op-summary', op.summary));
      card.append(info, icon('chevron'));
      list.append(accordion(operationKey(op), card, expanded, onExpansion, body => operationDetails(body, op, spec)));
    }
    parent.append(list);
  }
  if (!filtered.length) { const empty = el('div', 'empty'); empty.append(icon('code'), el('h2', '', query ? 'Sin coincidencias' : 'Tu API empieza aquí'), el('p', '', query ? 'Prueba con otra ruta, método o nombre de operación.' : 'Agrega operaciones en paths. La documentación se actualizará mientras escribes.')); parent.append(empty); }
  const schemas = Object.entries(obj(obj(spec.root.components).schemas ?? spec.root.definitions));
  if (schemas.length) {
    const filteredSchemas = schemas.filter(([name]) => name.toLowerCase().includes(query.trim().toLowerCase()));
    heading(parent, 'Esquemas', filteredSchemas.length, 'Modelos de datos');
    const list = el('div', 'schema-list');
    for (const [name, value] of filteredSchemas) {
      const summary = el('summary', 'schema-card');
      summary.append(icon('braces'), el('code', 'schema-name', name), badge(schemaType(value)), icon('chevron'));
      list.append(accordion(`schema:${name}`, summary, expanded, onExpansion, body => schema(value, spec, body)));
    }
    if (!filteredSchemas.length) list.append(el('p', 'schema-empty', 'No hay esquemas que coincidan con la búsqueda.'));
    parent.append(list);
  }
  const security = obj(spec.root.components).securitySchemes ?? spec.root.securityDefinitions;
  if (security) { heading(parent, 'Autenticación'); for (const [name, value] of Object.entries(obj(security))) jsonDetails(name, value, parent); }
  if (spec.root.webhooks) { heading(parent, 'Webhooks'); jsonDetails('Definiciones de webhooks', spec.root.webhooks, parent); }
}
export function renderPreview(parent: HTMLElement, spec: Spec | null, query: string, expanded: Set<string>, onExpansion: ExpansionHandler): void {
  parent.replaceChildren();
  if (!spec) { const empty = el('div', 'empty'); empty.append(icon('book'), el('h2', '', 'Un espacio para tu API'), el('p', '', 'Abre una especificación JSON o YAML. Su documentación aparecerá aquí.')); parent.append(empty); return; }
  overview(parent, spec, query, expanded, onExpansion);
  const footer = el('div', 'doc-footer'); footer.append(icon('lock'), document.createTextNode('Documento local · Sin conexión a servicios externos')); parent.append(footer);
}
