import { answerOption } from './answer-semantics';
import { isPlaceholderOption } from './autofill/match';
import { exclusiveAnswer, normalizeQuestion, type AnswerSelection } from './remembered-mappings';

export interface SelectionPlan { indices: number[]; labels: string[]; ok: boolean; reason: string }
/** All requested choices must map to distinct enabled options. No partial or top-result fallback. */
export function resolveRememberedSelections(selections: AnswerSelection[], options: string[], disabled: number[] = []): SelectionPlan {
  const indices: number[] = [];
  const labels: string[] = [];
  const fail = (reason: string): SelectionPlan => ({ ok: false, indices: [], labels: [], reason });
  if (!selections.length || selections.length > 20 || options.length > 200) return fail('This answer list is not supported.');
  if (selections.length > 1 && selections.some(s => exclusiveAnswer(s.value))) return fail('An exclusive answer must be selected by itself.');
  const offered = options.map((label, i) => disabled.includes(i) || isPlaceholderOption(label) ? '' : label);
  for (const selection of selections) {
    const index = answerOption(selection.value, offered, undefined, null, selection.aliases);
    if (index < 0) return fail('A saved selection is unavailable or ambiguous. Choose your answers on the page.');
    if (indices.includes(index)) return fail('Two saved selections match the same option. Check their alternate labels.');
    indices.push(index); labels.push(options[index]!);
  }
  if (labels.length > 1 && labels.some(exclusiveAnswer)) return fail('An exclusive answer must be selected by itself.');
  return { ok: true, indices, labels, reason: 'Every saved selection has a distinct matching choice.' };
}

export function sameSelections(a: string[], b: string[]): boolean {
  const left = a.map(normalizeQuestion).sort();
  const right = b.map(normalizeQuestion).sort();
  return left.length === right.length && left.every((v, i) => v === right[i]);
}
