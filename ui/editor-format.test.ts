import { describe, expect, it } from 'vitest';
import { Compartment, EditorState, Transaction } from '@codemirror/state';
import { history, isolateHistory, redo, undo } from '@codemirror/commands';
import { language } from '@codemirror/language';
import { yaml } from '@codemirror/lang-yaml';
import { formatEffects, formatHistory, sourceFormat } from './editor-format';
import { nameForFormat, type Format } from './types';

function documentHistory(source: string) {
  const syntax = new Compartment();
  let state = EditorState.create({ doc: source, extensions: [history(), sourceFormat, syntax.of(yaml()), formatHistory(syntax)] });
  return {
    get state() { return state; },
    convert(source: string, format: Format) {
      state = state.update({ changes: { from: 0, to: state.doc.length, insert: source }, effects: formatEffects(format, syntax), annotations: isolateHistory.of('full') }).state;
    },
    initialize(format: Format) {
      state = state.update({ effects: formatEffects(format, syntax), annotations: Transaction.addToHistory.of(false) }).state;
    },
    undo() { return undo({ state, dispatch: transaction => { state = transaction.state; } }); },
    redo() { return redo({ state, dispatch: transaction => { state = transaction.state; } }); },
  };
}

describe('format conversion history', () => {
  it('restores source, format and grammar when undoing and redoing conversion', () => {
    const yamlSource = '# Original comment\ninfo: {title: Petstore}\n';
    const jsonSource = '{"info":{"title":"Petstore"}}\n';
    const editor = documentHistory(yamlSource);
    editor.convert(jsonSource, 'Json');
    expect(editor.state.field(sourceFormat)).toBe('Json');
    expect(editor.state.facet(language)?.name).toBe('json');
    expect(editor.undo()).toBe(true);
    expect(editor.state.doc.toString()).toBe(yamlSource);
    expect(editor.state.field(sourceFormat)).toBe('Yaml');
    expect(editor.state.facet(language)?.name).toBe('yaml');
    expect(editor.redo()).toBe(true);
    expect(editor.state.doc.toString()).toBe(jsonSource);
    expect(editor.state.field(sourceFormat)).toBe('Json');
    expect(editor.state.facet(language)?.name).toBe('json');
    editor.convert('info:\n  title: Petstore\n', 'Yaml');
    expect(editor.undo()).toBe(true);
    expect(editor.state.doc.toString()).toBe(jsonSource);
    expect(editor.state.field(sourceFormat)).toBe('Json');
  });
  it('does not expose document initialization as an undoable conversion', () => {
    const editor = documentHistory('{}');
    editor.initialize('Json');
    expect(editor.state.field(sourceFormat)).toBe('Json');
    expect(editor.undo()).toBe(false);
  });
  it('keeps the original YAML extension and projects converted filenames', () => {
    expect(nameForFormat('api.yml', 'Json')).toBe('api.json');
    expect(nameForFormat('api.json', 'Yaml')).toBe('api.yaml');
    expect(nameForFormat('api.yml', 'Yaml')).toBe('api.yml');
    expect(nameForFormat('API.YML', 'Yaml')).toBe('API.YML');
    expect(nameForFormat('api.v1.JSON', 'Yaml')).toBe('api.v1.yaml');
  });
});
