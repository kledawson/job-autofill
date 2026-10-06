import { SavedAnswerIndex, scopeLabel, targetText, type MappingContext, type RememberedMapping } from './remembered-mappings';

export type MemoryFilter = 'all' | 'answer' | 'answers' | 'profile';
export type MemorySort = 'updated' | 'question' | 'used';
const searchText = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Browsing is local and read-only. It never approves an unfamiliar question or reads page answers. */
export function memoriesForPage(records: RememberedMapping[], questions: string[], context: MappingContext): RememberedMapping[] {
  return records.filter(record => {
    const index = new SavedAnswerIndex([record], context);
    return questions.some(label => !!index.match({ label, kind: 'combobox', selectionMode: 'unknown', options: [] }).mapping);
  });
}

export function browseMemories(records: RememberedMapping[], search: string, filter: MemoryFilter, sort: MemorySort): RememberedMapping[] {
  const terms = searchText(search).split(' ').filter(Boolean);
  return records.filter(m => {
    if (filter !== 'all' && m.target.kind !== filter) return false;
    const extra = m.target.kind === 'answers' ? m.target.selections.flatMap(s => s.aliases) : m.answerAliases ?? [];
    const text = searchText([m.question, ...m.aliases, targetText(m.target), ...extra, scopeLabel(m.scope), m.scope].join(' '));
    return terms.every(term => text.includes(term));
  }).sort((a, b) => (sort === 'question' ? a.question.localeCompare(b.question) : sort === 'used' ? (b.lastUsed ?? 0) - (a.lastUsed ?? 0) : b.updatedAt - a.updatedAt) || a.id - b.id);
}
