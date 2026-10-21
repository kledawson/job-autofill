import type { Application } from '@/lib/types';
import { feedbackPriority, FIELD_STATUS_LABELS, type FieldFeedback } from '@/lib/field-feedback';
import type { ReviewField } from '@/lib/remembered-mappings';
import { Button, cx } from './ui';

const STYLE: Record<FieldFeedback['status'], string> = {
  missing: 'border-red-200 bg-red-50/40', review: 'border-amber-200 bg-amber-50/60',
  verified: 'border-green-200 bg-green-50/40', entered: 'border-slate-200 bg-white', optional: 'border-slate-200 bg-white',
};
const SOURCE = { profile: 'Profile', memory: 'Memory', preset: 'Preset', ai: 'AI', page: 'Page answer', none: '' };

export function FieldReviewList({ app, disabled, capturing, onRemember, onShow }: {
  app: Application; disabled: boolean; capturing?: string;
  onRemember(field: ReviewField, suggestion?: boolean): void;
  onShow(token: string): void;
}) {
  const fields = app.reviewFields ?? [], byToken = new Map(fields.map(f => [f.token, f]));
  const feedback = [...app.fieldFeedback ?? []];
  for (const f of fields) if (!feedback.some(item => item.token === f.token)) feedback.push({
    token: f.token, label: f.label, required: false, status: f.answered ? 'entered' : 'missing', source: f.answered ? 'page' : 'none',
    reason: f.reason || 'Answer on the page, then review and save it here.',
  });
  const attention = feedback.filter(f => ['missing', 'review', 'optional'].includes(f.status) || byToken.has(f.token))
    .sort((a, b) => (byToken.get(a.token)?.answered ? 3 : feedbackPriority(a)) - (byToken.get(b.token)?.answered ? 3 : feedbackPriority(b)));
  const completed = feedback.filter(f => !attention.includes(f));
  function row(item: FieldFeedback) {
    const field = byToken.get(item.token);
    return <li key={item.token} data-review-token={item.token} className={cx('rounded-lg border p-2 text-xs text-slate-700', field?.answered && item.status !== 'missing' ? 'border-indigo-200 bg-indigo-50' : STYLE[item.status])}>
      <div className="flex items-start justify-between gap-2"><p className="font-medium break-words">{item.label}</p><span className="shrink-0 text-[11px] font-semibold">{FIELD_STATUS_LABELS[item.status]}</span></div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500"><span>{item.required ? 'Required' : 'Optional'}{SOURCE[item.source] && ` · ${SOURCE[item.source]}`}</span>
      <details><summary className="cursor-pointer underline">Why?</summary><p className="mt-1 text-slate-600">{field?.answered && item.status !== 'missing' ? field.selectionMode === 'multiple' ? `${field.selectedCount ?? 0} selections are ready to review and save.` : 'Answer entered. Review where it will be saved.' : item.reason}</p></details></div>
      <div className="mt-1.5 flex flex-wrap gap-2">
        <Button className="px-2 py-1 text-xs" variant="secondary" onClick={() => onShow(item.token)}>Show field</Button>
        {field && <Button className="px-2 py-1 text-xs" variant={field.answered ? 'primary' : 'secondary'} disabled={!!capturing || disabled} onClick={() => onRemember(field)}>{capturing === field.token ? 'Reading field…' : field.selectionMode === 'multiple' ? field.answered ? 'Save these answers' : 'Remember answers' : field.answered ? 'Save this answer' : 'Remember answer'}</Button>}
        {field?.suggestionId && !field.answered && <Button className="px-2 py-1 text-xs" variant="secondary" disabled={!!capturing || disabled} onClick={() => onRemember(field, true)}>Review suggestion</Button>}
      </div>
    </li>;
  }
  return <div className="space-y-2">
    <details className="text-xs text-slate-500"><summary className="cursor-pointer">Review guide</summary><p>Required gaps first, then answers to review. Green means a saved answer was verified; amber needs review; red needs attention.</p></details>
    <ul aria-label="Questions to review" className="mt-2 max-h-64 space-y-1.5 overflow-y-auto overscroll-contain pr-1">{attention.map(row)}
      {!app.fieldFeedback && app.missingLabels.filter((_, i) => !app.missingQuestions?.[i] || !fields.some(f => f.label === app.missingQuestions?.[i])).map((label, i) => <li key={`manual-${i}`} className="rounded-lg bg-slate-50 p-3 text-xs text-slate-700">{label}<p className="mt-1">{app.reviewFields ? 'Complete this field on the page.' : 'Click Fill this page to refresh results and enable field review.'}</p></li>)}
    </ul>
    {!!completed.length && <details><summary className="cursor-pointer text-xs font-medium text-slate-600">Verified & entered answers ({completed.length})</summary><p className="mt-1 text-xs text-slate-500">Saved facts may change. You can inspect every answer on the website.</p><ul aria-label="Filled fields" className="mt-2 max-h-64 space-y-2 overflow-y-auto">{completed.map(row)}</ul></details>}
    {!attention.length && <p className="text-xs text-slate-600">No missing or flagged answers in this result. Review the website before submitting.</p>}
  </div>;
}
