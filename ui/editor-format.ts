import { Compartment, StateEffect, StateField, type Extension } from '@codemirror/state';
import { invertedEffects } from '@codemirror/commands';
import { json } from '@codemirror/lang-json';
import { yaml } from '@codemirror/lang-yaml';
import type { Format } from './types';

const changeFormat = StateEffect.define<Format>();
export const sourceFormat = StateField.define<Format>({
  create: () => 'Yaml',
  update(format, transaction) {
    for (const effect of transaction.effects) if (effect.is(changeFormat)) format = effect.value;
    return format;
  },
});

export function formatEffects(format: Format, language: Compartment) {
  return [changeFormat.of(format), language.reconfigure(format === 'Json' ? json() : yaml())];
}

export function formatHistory(language: Compartment): Extension {
  // Conversion history must restore the grammar together with the document text.
  return invertedEffects.of(transaction => transaction.effects.some(effect => effect.is(changeFormat))
    ? formatEffects(transaction.startState.field(sourceFormat), language)
    : []);
}
