import { useState } from 'react';
import { scopeDescription } from '@/lib/saved-answer-preview';
import { scopeLabel, applicationKey, companyKey, type MappingContext, type MappingScope } from '@/lib/remembered-mappings';
import { Button, Field, Input, Select } from './ui';

export function ReuseScope({ value, onChange, context, disabled, label = 'Reuse for', ariaLabel }: {
  value: MappingScope; onChange(value: MappingScope): void; context?: MappingContext; disabled?: boolean; label?: string; ariaLabel?: string;
}) {
  const app = context ? 'application:' + applicationKey(context.url) as MappingScope : 'application:' as MappingScope;
  const simple: MappingScope[] = ['all', app];
  const [more, setMore] = useState(!simple.includes(value));
  const advanced: MappingScope[] = context ? [
    ...(context.company && !/^(unknown|company)$/i.test(context.company) ? ['company:' + companyKey(context.company) as MappingScope] : []),
    'site:' + new URL(context.url).origin as MappingScope,
  ] : ['company:', 'site:'];
  const selection = !context && /^(company|application|site):/.test(value) ? value.split(':')[0] + ':' as MappingScope : value;
  const choices = [...simple, ...(more ? advanced : [])];
  if (!choices.includes(selection)) choices.push(selection);
  return <div className="space-y-2">
    <Field label={label} hint={value === 'all' ? 'For matching questions across applications.' : value === app ? 'For this job only.' : scopeDescription(value)}><Select aria-label={ariaLabel} disabled={disabled} value={selection} onChange={e => onChange(e.target.value as MappingScope)} options={choices.map(s => [s, s === 'company:' ? 'Specific company' : s === 'site:' ? 'Specific website' : s === app ? 'This application' : scopeLabel(s)])} /></Field>
    {!more && <Button variant="ghost" className="px-0 text-xs" disabled={disabled} onClick={() => setMore(true)}>More limits: company or website</Button>}
    {!context && /^(company|application|site):/.test(value) && <Field label={value.startsWith('company:') ? 'Company name' : value.startsWith('site:') ? 'Website URL' : 'Application URL'} required><Input disabled={disabled} required type={value.startsWith('company:') ? 'text' : 'url'} value={value.slice(value.indexOf(':') + 1)} onChange={e => onChange(value.split(':')[0] + ':' + e.target.value as MappingScope)} /></Field>}
  </div>;
}
