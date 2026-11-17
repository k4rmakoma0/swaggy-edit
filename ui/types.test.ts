import { describe, expect, it } from 'vitest';
import { matches, resolve, type Operation, type ObjectValue } from './types';

describe('local reference rendering', () => {
  it('resolves escaped JSON Pointer segments and percent-encoded fragments', () => {
    const root: ObjectValue = { definitions: { 'A/B~C': { type: 'string' }, 'México': { type: 'object' } } };
    expect(resolve(root, { $ref: '#/definitions/A~1B~0C' }).value).toEqual({ type: 'string' });
    expect(resolve(root, { $ref: '#/definitions/M%C3%A9xico' }).value).toEqual({ type: 'object' });
  });
  it('bounds circular references and never retrieves external resources', () => {
    const root: ObjectValue = { A: { $ref: '#/B' }, B: { $ref: '#/A' } };
    expect(resolve(root, { $ref: '#/A' }).error).toContain('circular');
    expect(resolve(root, { $ref: 'https://example.com/private' }).error).toContain('externa');
    expect(resolve(root, { $ref: '#/missing' }).error).toContain('no encontrada');
  });
  it('does not resolve inherited object properties', () => {
    expect(resolve({}, { $ref: '#/toString' }).error).toContain('no encontrada');
    expect(resolve({}, { $ref: '#/__proto__' }).error).toContain('no encontrada');
  });
});
describe('endpoint search', () => {
  const operation: Operation = { path: '/pets/{id}', method: 'GET', tag: 'Pets', summary: 'Find a pet', value: { operationId: 'getPet' }, parameters: [] };
  it('matches all query terms across metadata, case-insensitively', () => {
    expect(matches(operation, 'get PETS')).toBe(true);
    expect(matches(operation, 'getPet')).toBe(true);
    expect(matches(operation, 'get missing')).toBe(false);
    expect(matches(operation, 'post')).toBe(false);
  });
});
