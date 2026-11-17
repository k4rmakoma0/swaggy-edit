import { basicSetup } from 'codemirror';
import { EditorView, keymap } from '@codemirror/view';
import { EditorState, Compartment, Transaction, type Extension } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import { formatEffects, formatHistory, sourceFormat } from './editor-format';
import { yaml } from '@codemirror/lang-yaml';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import type { Format } from './types';

export class SourceEditor {
  readonly view: EditorView;
  private configuration: Extension[];
  private dark = false;
  private language = new Compartment();
  private appearance = new Compartment();
  constructor(parent: HTMLElement, onChange: (source: string, format: Format) => void, onCursor: (line: number, column: number) => void) {
    this.configuration = [
      basicSetup,
      keymap.of([{ key: 'Tab', run: view => { const { from, to } = view.state.selection.main; view.dispatch({ changes: { from, to, insert: '  ' }, selection: { anchor: from + 2 } }); return true; } }]),
      this.language.of(yaml()), this.appearance.of(this.theme(false)), sourceFormat, formatHistory(this.language),
      EditorView.contentAttributes.of({ 'aria-label': 'Editor de la especificación', spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off' }),
      EditorView.updateListener.of(update => {
        const format = update.state.field(sourceFormat);
        if (update.docChanged || format !== update.startState.field(sourceFormat)) onChange(update.state.doc.toString(), format);
        if (update.selectionSet || update.docChanged) {
          const position = update.state.selection.main.head;
          const line = update.state.doc.lineAt(position);
          onCursor(line.number, position - line.from + 1);
        }
      }),
    ];
    this.view = new EditorView({ parent, state: EditorState.create({ extensions: this.configuration }) });
  }
  replace(source: string, format: Format, resetHistory = false): void {
    if (resetHistory) {
      this.view.setState(EditorState.create({ doc: source, extensions: this.configuration }));
      this.view.dispatch({ effects: formatEffects(format, this.language), annotations: Transaction.addToHistory.of(false) });
      this.setDark(this.dark);
    } else {
      this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: source }, effects: formatEffects(format, this.language), annotations: isolateHistory.of('full') });
    }
  }
  setDark(dark: boolean): void { this.dark = dark; this.view.dispatch({ effects: this.appearance.reconfigure(this.theme(dark)) }); }
  private theme(dark: boolean) {
    return [EditorView.theme({
      '&': { height: '100%', backgroundColor: 'transparent', color: dark ? '#d3d9e5' : '#303948', fontSize: 'var(--code-size, 12px)' },
      '.cm-scroller': { fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', monospace", lineHeight: '1.85', overflow: 'auto' },
      '.cm-content': { padding: '20px 0', caretColor: 'var(--accent)' },
      '.cm-line': { padding: '0 24px 0 12px' },
      '.cm-gutters': { backgroundColor: 'transparent', color: dark ? '#667183' : '#a4acb7', border: 'none', padding: '0 10px 0 12px', minWidth: '45px' },
      '.cm-gutterElement': { lineHeight: '1.85' },
      '.cm-activeLineGutter, .cm-activeLine': { backgroundColor: dark ? '#ffffff04' : '#0a84ff04' },
      '&.cm-focused': { outline: 'none' },
      '.cm-cursor': { borderLeftColor: 'var(--accent)' },
      '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: dark ? '#184a764f' : '#c9e1ff80' },
      '.cm-panels': { backgroundColor: 'var(--surface)', color: 'var(--text)', borderColor: 'var(--border)' },
      '.cm-search': { padding: '10px', fontFamily: 'var(--font)' },
      '.cm-textfield, .cm-button': { fontFamily: 'var(--font)', borderRadius: '5px', background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)' },
      '.cm-tooltip': { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' },
    }, { dark }), syntaxHighlighting(HighlightStyle.define([
      { tag: [tags.propertyName, tags.definition(tags.propertyName)], color: dark ? '#9ab9eb' : '#335e9c' },
      { tag: [tags.string, tags.special(tags.string)], color: dark ? '#a4c5ad' : '#5c7f5d' },
      { tag: [tags.number, tags.bool, tags.null], color: dark ? '#c1a9d8' : '#9867a3' },
      { tag: tags.comment, color: dark ? '#788497' : '#929aa6', fontStyle: 'italic' },
      { tag: tags.punctuation, color: dark ? '#8995a7' : '#929aa6' },
    ]))];
  }
}
