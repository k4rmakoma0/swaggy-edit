const paths = {
  code: '<path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-14-2 18"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  folder: '<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v2M3 7h16a2 2 0 0 1 2 2l-2 10H3L1 9a2 2 0 0 1 2-2Z"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2Z"/><path d="M7 3v6h10V3M7 21v-8h10v8"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  layout: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 3v18"/>',
  book: '<path d="M12 6c-3-3-7-3-10-2v15c4-1 7-1 10 2 3-3 6-3 10-2V4c-3-1-7-1-10 2Zm0 0v15"/>',
  split: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M12 4v16"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  arrow: '<path d="m12 5-7 7 7 7m-7-7h16"/>',
  plus: '<path d="M12 4v16M4 12h16"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  moon: '<path d="M20.8 13A9 9 0 0 1 11 3.2 9 9 0 1 0 20.8 13Z"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  alert: '<path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v4m0 3v1"/>',
  globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  bolt: '<path d="m13 2-9 12h7l-1 8 10-13h-7l1-7Z"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
  braces: '<path d="M9 3H7v6l-3 3 3 3v6h2M15 3h2v6l3 3-3 3v6h-2"/>',
  filter: '<path d="M4 5h16M7 12h10m-7 7h4"/>',
  expand: '<path d="M12 3v6m-3-3 3-3 3 3M12 21v-6m-3 3 3 3 3-3M4 12h16"/>',
  collapse: '<path d="M12 3v6m-3-3 3 3 3-3M12 21v-6m-3 3 3-3 3 3M4 12h16"/>',
  format: '<path d="M4 5h16M4 10h11M4 15h16M4 20h11"/>',
} as const;
export type IconName = keyof typeof paths;
export function icon(name: IconName, size = 18): SVGSVGElement {
  const wrapper = document.createElement('span');
  // Only developer-authored SVG paths enter this template.
  wrapper.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
  return wrapper.firstElementChild as SVGSVGElement;
}
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
export function button(label: string, name: IconName | null, action: () => void, className = ''): HTMLButtonElement {
  const node = el('button', className);
  node.type = 'button'; node.title = label; node.setAttribute('aria-label', label);
  if (name) node.append(icon(name));
  if (!className.includes('icon-button')) node.append(el('span', '', label));
  node.addEventListener('click', action);
  return node;
}
export function badge(text: string, className = ''): HTMLElement { return el('span', `badge ${className}`, text); }
export async function copyText(text: string, trigger: HTMLButtonElement): Promise<void> {
  try { await navigator.clipboard.writeText(text); trigger.replaceChildren(icon('check', 15)); setTimeout(() => trigger.replaceChildren(icon('copy', 15)), 1300); }
  catch { trigger.title = 'Selecciona el texto y usa Copiar'; }
}
