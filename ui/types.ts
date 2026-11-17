export type Format = 'Json' | 'Yaml';
export type Mode = 'view' | 'edit' | 'split';
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type ObjectValue = { [key: string]: Json };
export interface Operation { path: string; method: string; tag: string; summary: string; value: ObjectValue; parameters: Json[] }
export interface Diagnostic { error: boolean; location: string; message: string }
export interface Spec { root: ObjectValue; operations: Operation[]; diagnostics: Diagnostic[] }
export interface DocumentSnapshot { source: string; format: Format; path: string | null; name: string }
export const obj = (value: Json | undefined): ObjectValue => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
export const arr = (value: Json | undefined): Json[] => Array.isArray(value) ? value : [];
export const str = (value: Json | undefined): string => typeof value === 'string' ? value : '';
export const operationKey = (operation: Operation): string => `${operation.method} ${operation.path}`;
export function previewSectionKeys(spec: Spec): string[] {
  return [...spec.operations.map(operationKey), ...Object.keys(obj(obj(spec.root.components).schemas ?? spec.root.definitions)).map(name => `schema:${name}`)];
}
export function nameForFormat(name: string, format: Format): string {
  if (format === 'Yaml' && /\.ya?ml$/i.test(name) || format === 'Json' && /\.json$/i.test(name)) return name;
  const stem = name.replace(/\.(json|ya?ml)$/i, '');
  return `${stem}.${format === 'Json' ? 'json' : 'yaml'}`;
}
export function matches(operation: Operation, query: string): boolean {
  const haystack = `${operation.path} ${operation.method} ${operation.tag} ${operation.summary} ${str(operation.value.operationId)}`.toLowerCase();
  return query.toLowerCase().split(/\s+/).every(word => haystack.includes(word));
}
export function resolve(root: ObjectValue, input: Json): { value: Json; error?: string } {
  let value = input;
  const seen = new Set<string>();
  while (typeof obj(value).$ref === 'string') {
    const ref = str(obj(value).$ref);
    if (seen.has(ref)) return { value, error: `Referencia circular: ${ref}` };
    seen.add(ref);
    if (!ref.startsWith('#/') && ref !== '#') return { value, error: `Referencia externa o ancla sin resolver: ${ref}` };
    let pointer: string;
    try { pointer = decodeURIComponent(ref.slice(1)); } catch { return { value, error: `Referencia inválida: ${ref}` }; }
    let found: Json | undefined = root;
    for (const segment of pointer ? pointer.slice(1).split('/') : []) {
      const key = segment.replace(/~1/g, '/').replace(/~0/g, '~');
      found = Array.isArray(found) ? found[Number(key)] : Object.hasOwn(obj(found), key) ? obj(found)[key] : undefined;
    }
    if (found === undefined) return { value, error: `Referencia no encontrada: ${ref}` };
    value = found;
  }
  return { value };
}
