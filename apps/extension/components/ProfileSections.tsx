import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DECLINE, emptyEducation, emptyExperience, racesOf, type Education, type Experience, type Profile, CLEARANCE_LEVELS, WORK_STATUSES } from '@/lib/types';
import { DEGREE_TYPES, SPECIFIC_DEGREES, standardDegree } from '@/lib/degree';
import { confirmDelete } from './confirm-delete';
import { Button, Card, DateInput, Field, Grid, Input, MonthInput, PrefixInput, Select, Textarea } from './ui';

export interface SectionProps {
  profile: Profile;
  onChange: (next: Profile) => void;
}

const YES_NO: [string, string][] = [
  ['', 'Select…'],
  ['yes', 'Yes'],
  ['no', 'No'],
];

export const EEO_OPTIONS = {
  gender: [DECLINE, 'Female', 'Male', 'Non-binary'],
  race: [
    'American Indian or Alaska Native',
    'Asian',
    'Black or African American',
    'Middle Eastern or North African',
    'Native Hawaiian or Other Pacific Islander',
    'White',
    DECLINE,
  ],
  hispanic: [DECLINE, 'Yes', 'No'],
  veteran: [
    DECLINE,
    'I am not a protected veteran',
    'I identify as one or more of the classifications of protected veteran',
  ],
  disability: [DECLINE, 'No, I do not have a disability', 'Yes, I have a disability (or previously had a disability)'],
};

const PRONOUNS = ['He/Him', 'She/Her', 'They/Them', 'He/They', 'She/They'];
/** Standard pronouns, plus the saved value when it is something else so nothing is lost. */
function pronounOptions(current: string): [string, string][] {
  const known = PRONOUNS.some((o) => o.toLowerCase() === current.trim().toLowerCase());
  const list = current.trim() && !known ? [...PRONOUNS, current] : PRONOUNS;
  return [['', 'Select…'], ...list.map((o) => [o, o] as [string, string])];
}

export function BasicsSection({ profile: p, onChange }: SectionProps) {
  const set = (patch: Partial<Profile>) => onChange({ ...p, ...patch });
  return (
    <Card title="About You" description="Used for name, contact, and address fields">
      <div className="space-y-4">
        <Grid>
          <Field label="First Name" required hint="Used on applications that also ask for a preferred name. Otherwise your preferred name is used here, if you have one">
            <Input value={p.firstName} onChange={(e) => set({ firstName: e.target.value })} autoComplete="given-name" />
          </Field>
          <Field label="Last Name" required>
            <Input value={p.lastName} onChange={(e) => set({ lastName: e.target.value })} autoComplete="family-name" />
          </Field>
        </Grid>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <Field label="Preferred Name" hint="Fills a preferred-name box when an application has one. Otherwise it replaces your first name. Leave blank to always use your first name" className="sm:col-span-2">
            <Input value={p.preferredName} onChange={(e) => set({ preferredName: e.target.value })} />
          </Field>
          <Field label="Age">
            <Input value={p.age} onChange={(e) => set({ age: e.target.value.replace(/\D/g, '').slice(0, 3) })} inputMode="numeric" placeholder="25" />
          </Field>
          <Field label="Pronouns">
            <Select options={pronounOptions(p.pronouns)} value={p.pronouns} onChange={(e) => set({ pronouns: e.target.value })} />
          </Field>
        </div>
        <Grid>
          <Field label="Email" required>
            <Input type="email" value={p.email} onChange={(e) => set({ email: e.target.value })} autoComplete="email" />
          </Field>
          <div className="grid grid-cols-[6rem_1fr] gap-3">
            <Field label="Country Code" hint="Default +1 (US)">
              <Input value={p.countryCode} onChange={(e) => set({ countryCode: e.target.value })} placeholder="+1" inputMode="tel" />
            </Field>
            <Field label="Phone" required hint="Without the country code">
              <Input type="tel" value={p.phone} onChange={(e) => set({ phone: e.target.value })} autoComplete="tel-national" />
            </Field>
          </div>
          <label className="flex items-start gap-2 text-sm text-slate-700 sm:col-span-2">
            <input
              type="checkbox"
              className="mt-0.5 size-4 rounded border-slate-300 accent-indigo-600"
              checked={p.textConsent}
              onChange={(e) => set({ textConsent: e.target.checked })}
            />
            <span>
              I consent to receive text message updates about my job applications
              <span className="block text-xs text-slate-500">Checked answers “Yes” when an application asks; unchecked answers “No”</span>
            </span>
          </label>
        </Grid>
        <Grid>
          <Field label="Street Address">
            <Input value={p.address} onChange={(e) => set({ address: e.target.value })} autoComplete="street-address" />
          </Field>
          <Field label="City" required>
            <Input value={p.city} onChange={(e) => set({ city: e.target.value })} />
          </Field>
        </Grid>
        <Grid cols={3}>
          <Field label="State" required>
            <Input value={p.state} onChange={(e) => set({ state: e.target.value })} placeholder="CA" />
          </Field>
          <Field label="ZIP">
            <Input value={p.zip} onChange={(e) => set({ zip: e.target.value })} />
          </Field>
          <Field label="Country">
            <Input value={p.country} onChange={(e) => set({ country: e.target.value })} />
          </Field>
        </Grid>
      </div>
    </Card>
  );
}

export function LinksSection({ profile: p, onChange }: SectionProps) {
  const set = (patch: Partial<Profile>) => onChange({ ...p, ...patch });
  return (
    <Card title="Links">
      <Grid>
        <Field label="LinkedIn">
          <Input value={p.linkedin} onChange={(e) => set({ linkedin: e.target.value })} placeholder="https://linkedin.com/in/…" />
        </Field>
        <Field label="GitHub">
          <Input value={p.github} onChange={(e) => set({ github: e.target.value })} placeholder="https://github.com/…" />
        </Field>
        <Field label="Portfolio">
          <Input value={p.portfolio} onChange={(e) => set({ portfolio: e.target.value })} />
        </Field>
        <Field label="Personal Website">
          <Input value={p.website} onChange={(e) => set({ website: e.target.value })} />
        </Field>
      </Grid>
    </Card>
  );
}

export function WorkAuthSection({ profile: p, onChange }: SectionProps) {
  const set = (patch: Partial<Profile['workAuth']>) => onChange({ ...p, workAuth: { ...p.workAuth, ...patch } });
  return (
    <Card title="Work Authorization" description="Answers the standard yes/no eligibility questions">
      <Grid>
        <Field label="Authorized to Work in the US?" required>
          <Select
            options={YES_NO}
            value={p.workAuth.authorizedUS}
            onChange={(e) => set({ authorizedUS: e.target.value as Profile['workAuth']['authorizedUS'] })}
          />
        </Field>
        <Field label="Need Sponsorship Now or in the Future?" required>
          <Select
            options={YES_NO}
            value={p.workAuth.needsSponsorship}
            onChange={(e) => set({ needsSponsorship: e.target.value as Profile['workAuth']['needsSponsorship'] })}
          />
        </Field>
        <Field label="Current Status" required>
          <Select
            options={['', ...WORK_STATUSES].map((o) => [o, o || 'Select…'] as [string, string])}
            value={p.workAuth.status}
            onChange={(e) => set({ status: e.target.value })}
          />
        </Field>
        <Field label="Are You a Citizen of Any Other Country?" hint="Answers export-control questions about listed countries">
          <Select
            options={YES_NO}
            value={p.workAuth.otherCitizenship}
            onChange={(e) => set({ otherCitizenship: e.target.value as Profile['workAuth']['otherCitizenship'] })}
          />
        </Field>
        {p.workAuth.otherCitizenship === 'yes' && (
          <Field label="Which Other Countries?" hint="Comma-separated, e.g. Canada, Mexico" className="sm:col-span-2">
            <Input value={p.workAuth.otherCountries} onChange={(e) => set({ otherCountries: e.target.value })} placeholder="Canada" />
          </Field>
        )}
        <Field label="Active Security Clearance">
          <Select
            options={['', ...CLEARANCE_LEVELS].map((o) => [o, o || 'Select…'] as [string, string])}
            value={p.workAuth.clearance}
            onChange={(e) => set({ clearance: e.target.value })}
          />
        </Field>
        <Field label="Current or Former U.S. Government Employee?">
          <Select
            options={YES_NO}
            value={p.workAuth.govEmployee}
            onChange={(e) => set({ govEmployee: e.target.value as Profile['workAuth']['govEmployee'] })}
          />
        </Field>
      </Grid>
    </Card>
  );
}

function ListControls({ onRemove, canRemove, what }: { onRemove: () => void; canRemove: boolean; what: string }) {
  return canRemove ? (
    <Button variant="secondary" onClick={async () => { if (await confirmDelete('Remove ' + what + '?', 'This removes the entry from your draft. Save your profile to make the removal permanent.', 'Remove')) onRemove(); }}>
      Remove
    </Button>
  ) : null;
}

/** Standard degree types, plus the saved value when it is something else so nothing is lost. */
function degreeOptions(current: string): [string, string][] {
  // Specific degrees first: "Bachelor of Science" answers forms that list it, and still counts as a bachelor's.
  const all: string[] = [...SPECIFIC_DEGREES, ...DEGREE_TYPES];
  const types: [string, string][] = [['', 'Select…'], ...all.map((t) => [t, t] as [string, string])];
  const saved = all.includes(current) ? current : standardDegree(current) || current;
  return saved && !all.includes(saved) ? [...types, [saved, saved]] : types;
}

export function EducationSection({ profile: p, onChange }: SectionProps) {
  const update = (i: number, patch: Partial<Education>) =>
    onChange({ ...p, education: p.education.map((e, j) => (j === i ? { ...e, ...patch } : e)) });
  return (
    <Card
      title="Education"
      description="Automatically sorted to most recent first when you save your profile"
    >
      <div className="space-y-6">
        {p.education.map((e, i) => (
          <div key={i} className={i ? 'border-t border-slate-100 pt-5' : ''}>
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold uppercase tracking-wide text-slate-500">School {i + 1}</span>
              <ListControls
                canRemove={p.education.length > 1}
                what={`School ${i + 1}`}
                onRemove={() => onChange({ ...p, education: p.education.filter((_, j) => j !== i) })}
              />
            </div>
            <Grid>
              <Field label="School" required className="sm:col-span-2">
                <Input value={e.school} onChange={(ev) => update(i, { school: ev.target.value })} placeholder="University of …" />
              </Field>
              <Field label="Degree Type" required hint="Fills the degree dropdown">
                <Select
                  options={degreeOptions(e.degree)}
                  value={(SPECIFIC_DEGREES as readonly string[]).includes(e.degree) ? e.degree : standardDegree(e.degree) || e.degree}
                  onChange={(ev) => update(i, { degree: ev.target.value })}
                />
              </Field>
              <Field label="Field of Study / Discipline" required hint="Fills the major or discipline field">
                <Input value={e.major} onChange={(ev) => update(i, { major: ev.target.value })} placeholder="Computer Science" />
              </Field>
              <Field label="Start">
                <MonthInput value={e.startDate} yearsAhead={0} onChange={(v) => update(i, { startDate: v })} />
              </Field>
              <Field label="End (or Expected)">
                <MonthInput value={e.endDate} onChange={(v) => update(i, { endDate: v })} />
              </Field>
              <Field label="GPA">
                <Input value={e.gpa} onChange={(ev) => update(i, { gpa: ev.target.value })} placeholder="3.7" />
              </Field>
              <Field label="Honors">
                <Input value={e.honors} onChange={(ev) => update(i, { honors: ev.target.value })} />
              </Field>
            </Grid>
          </div>
        ))}
        <Button variant="secondary" className="-mt-2" onClick={() => onChange({ ...p, education: [...p.education, emptyEducation()] })}>
          Add school
        </Button>
      </div>
    </Card>
  );
}

const BULLET = '◦ ';
const stripBullet = (l: string) => l.replace(/^\s*[◦•●▪‣⁃∙·*-]\s*/, '');
const toStored = (text: string) => text.split('\n').map(stripBullet).map((l) => l.trim()).filter(Boolean).join('\n');
const toDisplay = (stored: string) => (stored ? stored.split('\n').map((l) => BULLET + l).join('\n') : '');

/** Shows each line as a "◦" bullet while the profile keeps plain lines. */
function BulletsInput({ value, onChange }: { value: string; onChange: (bullets: string) => void }) {
  const [text, setText] = useState(toDisplay(value));
  // Pick up changes that did not come from typing here, e.g. a resume import.
  useEffect(() => {
    setText((t) => (toStored(t) === value ? t : toDisplay(value)));
  }, [value]);
  const edit = (next: string) => {
    // Keep a bullet on every line, including freshly added ones.
    const display = next.split('\n').map((l) => (l.trim() ? BULLET + stripBullet(l).replace(/^\s+/, '') : l)).join('\n');
    setText(display);
    onChange(toStored(display));
  };
  return (
    <Textarea
      rows={5}
      value={text}
      placeholder={'◦ Built …\n◦ Improved … by …%'}
      onFocus={() => !text && setText(BULLET)}
      onBlur={() => !toStored(text) && setText('')}
      onChange={(e) => edit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' || e.shiftKey) return;
        e.preventDefault();
        const el = e.currentTarget;
        const { selectionStart: s, selectionEnd: end } = el;
        const next = `${text.slice(0, s)}\n${BULLET}${text.slice(end)}`;
        setText(next);
        onChange(toStored(next));
        requestAnimationFrame(() => el.setSelectionRange(s + 1 + BULLET.length, s + 1 + BULLET.length));
      }}
    />
  );
}

export function ExperienceSection({ profile: p, onChange }: SectionProps) {
  const set = (patch: Partial<Profile>) => onChange({ ...p, ...patch });
  const update = (i: number, patch: Partial<Experience>) =>
    onChange({ ...p, experience: p.experience.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  return (
    <Card
      title="Experience"
      description="Used to fill experience fields and write free responses, so include specifics like projects, tools, and results. Automatically sorted to most recent first when you save your profile"
    >
      <div className="space-y-6">
        <Grid>
          <Field label="Current Company" hint="Leave blank to answer “N/A”">
            <Input
              value={p.currentCompany}
              onChange={(e) => set({ currentCompany: e.target.value })}
              placeholder="Apple"
              autoComplete="organization"
            />
          </Field>
          <Field label="Current Position" hint="Leave blank to answer “N/A”">
            <Input
              value={p.currentTitle}
              onChange={(e) => set({ currentTitle: e.target.value })}
              placeholder="Software Engineer"
              autoComplete="organization-title"
            />
          </Field>
          <Field label="Previous Employer" hint="Leave blank to answer “N/A”">
            <Input value={p.previousCompany} onChange={(e) => set({ previousCompany: e.target.value })} placeholder="Google" />
          </Field>
          <Field label="Previous Position" hint="Leave blank to answer “N/A”">
            <Input value={p.previousTitle} onChange={(e) => set({ previousTitle: e.target.value })} placeholder="Software Engineering Intern" />
          </Field>
        </Grid>
        <hr className="border-slate-100" />
        {p.experience.map((x, i) => (
          <div key={i} className={i ? 'border-t border-slate-100 pt-5' : ''}>
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold uppercase tracking-wide text-slate-500">Job {i + 1}</span>
              <ListControls
                canRemove={p.experience.length > 1}
                what={`Job ${i + 1}`}
                onRemove={() => onChange({ ...p, experience: p.experience.filter((_, j) => j !== i) })}
              />
            </div>
            <Grid>
              <Field label="Title" required>
                <Input value={x.title} onChange={(e) => update(i, { title: e.target.value })} placeholder="Software Engineering Intern" />
              </Field>
              <Field label="Company" required>
                <Input value={x.company} onChange={(e) => update(i, { company: e.target.value })} />
              </Field>
              <Field label="Location" required className="sm:col-span-2">
                <Input value={x.location} onChange={(e) => update(i, { location: e.target.value })} />
              </Field>
              <Field label="Start" required>
                <MonthInput value={x.startDate} yearsAhead={0} onChange={(v) => update(i, { startDate: v })} />
              </Field>
              <Field label="End" required={!x.current}>
                <MonthInput value={x.current ? '' : x.endDate} disabled={x.current} onChange={(v) => update(i, { endDate: v })} />
              </Field>
              <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2">
                <input
                  type="checkbox"
                  className="size-4 rounded border-slate-300 accent-indigo-600"
                  checked={x.current}
                  onChange={(e) => update(i, { current: e.target.checked, endDate: e.target.checked ? '' : x.endDate })}
                />
                I currently work here
              </label>
              <Field label="Responsibilities/What You Did" className="sm:col-span-2">
                <BulletsInput value={x.bullets} onChange={(bullets) => update(i, { bullets })} />
              </Field>
            </Grid>
          </div>
        ))}
        <Button variant="secondary" className="-mt-2" onClick={() => onChange({ ...p, experience: [...p.experience, emptyExperience()] })}>
          Add job
        </Button>
      </div>
    </Card>
  );
}

const moved = <T,>(list: T[], from: number, to: number): T[] => {
  const next = [...list];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
};

const CHIP = 'select-none touch-none rounded-full py-1 pr-4 pl-3 text-sm';

/** Skills as removable chips. Drag a chip anywhere in the list to reorder; autofill adds them in this order. */
export function SkillsSection({ profile: p, onChange }: SectionProps) {
  const [text, setText] = useState('');
  // While dragging: the skill held, where its slot is now, and the pointer position for the floating copy.
  const [drag, setDrag] = useState<{ skill: string; over: number; x: number; y: number; dx: number; dy: number } | null>(null);
  const [pressed, setPressed] = useState<{ skill: string; id: number; x: number; y: number; dx: number; dy: number } | null>(null);
  const chips = useRef<(HTMLLIElement | null)[]>([]);
  const set = (skills: string[]) => onChange({ ...p, skills });
  const add = () => {
    const known = new Set(p.skills.map((k) => k.toLowerCase()));
    const fresh = text
      .split(',')
      .map((k) => k.trim())
      .filter((k) => k && !known.has(k.toLowerCase()) && known.add(k.toLowerCase()));
    if (fresh.length) set([...p.skills, ...fresh]);
    setText('');
  };
  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= p.skills.length) return;
    set(moved(p.skills, from, to));
  };
  // The order shown right now: the held chip's slot follows the pointer, the others make room.
  const shown = drag ? moved(p.skills, p.skills.indexOf(drag.skill), drag.over) : p.skills;

  // Window-level listeners: reordering moves the chips in the page, which would drop a pointer captured on one.
  useEffect(() => {
    if (!pressed) return;
    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== pressed.id) return;
      if (!drag) {
        if (Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) < 4) return;
        setDrag({ skill: pressed.skill, over: p.skills.indexOf(pressed.skill), x: e.clientX, y: e.clientY, dx: pressed.dx, dy: pressed.dy });
        return;
      }
      // The slot goes after every other chip that sits before the pointer (earlier row, or same row and left of it).
      // Judging by position, not by the chip under the pointer, keeps the others from flickering as they shift.
      const before = chips.current.filter((c, i) => {
        if (!c || i === drag.over) return false;
        const r = c.getBoundingClientRect();
        if (r.bottom < e.clientY) return true;
        return r.top <= e.clientY && r.left + r.width / 2 < e.clientX;
      }).length;
      setDrag({ ...drag, over: before, x: e.clientX, y: e.clientY });
    };
    const finish = (commit: boolean) => {
      if (drag && commit) move(p.skills.indexOf(drag.skill), drag.over);
      setPressed(null);
      setDrag(null);
    };
    const onUp = (e: PointerEvent) => e.pointerId === pressed.id && finish(true);
    const onCancel = (e: PointerEvent) => e.pointerId === pressed.id && finish(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pressed, drag, p.skills]);

  return (
    <Card title="Skills" description="Add several at once by separating them with commas. Skills are added to applications one by one, in this order, so drag your most important skills to the front">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <Input aria-label="Skill" value={text} onChange={(e) => setText(e.target.value)} placeholder="Python" />
        <Button type="submit" variant="secondary" className="shrink-0" disabled={!text.trim()}>
          Add Skill
        </Button>
      </form>
      {p.skills.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-x-2 gap-y-3" aria-label="Your skills, most important first">
          {shown.map((skill, i) => {
            const held = drag?.skill === skill;
            return (
              <li
                key={skill}
                ref={(node) => {
                  chips.current[i] = node;
                }}
                tabIndex={0}
                title="Drag to reorder, or press Alt + Left or Right Arrow"
                onPointerDown={(e) => {
                  if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
                  const r = e.currentTarget.getBoundingClientRect();
                  setPressed({ skill, id: e.pointerId, x: e.clientX, y: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top });
                }}
                onKeyDown={(e) => {
                  if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
                  e.preventDefault();
                  const to = i + (e.key === 'ArrowLeft' ? -1 : 1);
                  move(i, to);
                  requestAnimationFrame(() => (e.currentTarget.parentElement?.children[to] as HTMLElement | undefined)?.focus());
                }}
                className={`${CHIP} relative ${held ? 'bg-transparent text-transparent' : 'cursor-grab bg-indigo-50 text-indigo-800 ring-1 ring-indigo-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500'}`}
              >
                {skill}
                <button
                  type="button"
                  aria-label={`Remove ${skill}`}
                  className={`absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full bg-white text-xs leading-none text-slate-500 shadow ring-1 ring-slate-300 hover:bg-red-50 hover:text-red-700 ${held ? 'invisible' : ''}`}
                  onClick={async () => { if (await confirmDelete('Remove skill?', skill + ' will be removed from your draft. Save your profile to make it permanent.', 'Remove')) set(p.skills.filter((k) => k !== skill)); }}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {drag && (
        <div
          aria-hidden
          className={`${CHIP} pointer-events-none fixed z-50 cursor-grabbing bg-indigo-50 text-indigo-800 shadow-lg ring-2 ring-indigo-500`}
          style={{ left: drag.x - drag.dx, top: drag.y - drag.dy }}
        >
          {drag.skill}
        </div>
      )}
    </Card>
  );
}

/** Drops a typed "$" and adds thousands commas while the entry is a plain number. Ranges like "100k-120k" are left as typed. */
function formatSalary(raw: string): string {
  const text = raw.replace(/^\s*\$\s*/, '');
  if (!/^[\d,]*$/.test(text)) return text;
  const digits = text.replace(/,/g, '');
  return digits ? Number(digits).toLocaleString('en-US') : '';
}

/** Salary box that formats as you type and keeps the cursor next to the digit you were editing. */
function SalaryInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (caret.current !== null) ref.current?.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  });
  return (
    <PrefixInput
      ref={ref}
      prefix="$"
      value={value}
      placeholder="120,000"
      onChange={(e) => {
        const raw = e.target.value;
        const pos = e.target.selectionStart ?? raw.length;
        const next = formatSalary(raw);
        // Characters before the cursor that are neither commas nor a dropped "$", re-counted in the formatted text.
        const dropped = raw.length - raw.replace(/^\s*\$\s*/, '').length;
        let keep = raw.slice(0, pos).replace(/,/g, '').length - Math.min(dropped, pos);
        let at = 0;
        while (keep > 0 && at < next.length) {
          if (next[at] !== ',') keep--;
          at++;
        }
        caret.current = at;
        onChange(next);
      }}
    />
  );
}

export function PreferencesSection({ profile: p, onChange }: SectionProps) {
  const set = (patch: Partial<Profile['preferences']>) => onChange({ ...p, preferences: { ...p.preferences, ...patch } });
  return (
    <Card title="Common Questions" description="Answers reused on every application">
      <Grid>
        <Field label="Desired Salary">
          <SalaryInput value={p.preferences.salary} onChange={(salary) => set({ salary })} />
        </Field>
        <Field label="Earliest Start Date" hint="Leave blank to use two weeks from the day you apply">
          <DateInput
            yearsBack={0}
            value={/^\d{4}-\d{2}-\d{2}$/.test(p.preferences.startDate) ? p.preferences.startDate : ''}
            onChange={(v) => set({ startDate: v })}
          />
        </Field>
        <Field label="Work Arrangement" hint="Flexible answers Yes to remote, hybrid, and on-site">
          <Select
            options={[
              ['', 'Select…'],
              ['remote', 'Remote'],
              ['hybrid', 'Hybrid'],
              ['onsite', 'On-site'],
              ['flexible', 'Flexible'],
            ]}
            value={p.preferences.workMode}
            onChange={(e) => set({ workMode: e.target.value as Profile['preferences']['workMode'] })}
          />
        </Field>
        <Field label="Willing to Relocate?">
          <Select
            options={YES_NO}
            value={p.preferences.relocate}
            onChange={(e) => set({ relocate: e.target.value as Profile['preferences']['relocate'] })}
          />
        </Field>
        <Field label="Bound by a Non-Compete or Non-Solicitation Agreement?" hint="With your current or a past employer">
          <Select
            options={YES_NO}
            value={p.preferences.nonCompete}
            onChange={(e) => set({ nonCompete: e.target.value as Profile['preferences']['nonCompete'] })}
          />
        </Field>
      </Grid>
    </Card>
  );
}

export function EeoSection({ profile: p, onChange }: SectionProps) {
  const set = (patch: Partial<Profile['eeo']>) => onChange({ ...p, eeo: { ...p.eeo, ...patch } });
  const opts = (list: string[]) => list.map((o) => [o, o] as [string, string]);
  return (
    <Card
      title="Voluntary Self-Identification"
      description="Optional. Each defaults to “Decline to answer.” These answers only fill matching dropdowns and are never sent to Gemini."
    >
      <Grid>
        <Field label="Gender">
          <Select options={opts(EEO_OPTIONS.gender)} value={p.eeo.gender} onChange={(e) => set({ gender: e.target.value })} />
        </Field>
        <Field label="Hispanic or Latino">
          <Select options={opts(EEO_OPTIONS.hispanic)} value={p.eeo.hispanic} onChange={(e) => set({ hispanic: e.target.value })} />
        </Field>
        <RaceField value={p.eeo.race} onChange={(race) => set({ race })} />
        <Field label="Veteran Status">
          <Select options={opts(EEO_OPTIONS.veteran)} value={p.eeo.veteran} onChange={(e) => set({ veteran: e.target.value })} />
        </Field>
        <Field label="Disability Status">
          <Select
            options={opts(EEO_OPTIONS.disability)}
            value={p.eeo.disability}
            onChange={(e) => set({ disability: e.target.value })}
          />
        </Field>
      </Grid>
    </Card>
  );
}

/** Fields the fill engine needs for a useful first run. */
export function missingRequired(p: Profile): string[] {
  const out: string[] = [];
  if (!p.firstName) out.push('first name');
  if (!p.lastName) out.push('last name');
  if (!p.email) out.push('email');
  if (!p.phone) out.push('phone');
  if (!p.city) out.push('city');
  if (!p.workAuth.authorizedUS) out.push('work authorization');
  if (!p.workAuth.needsSponsorship) out.push('sponsorship');
  if (!p.workAuth.status) out.push('current status');
  if (p.education.some((e) => !e.school || !e.degree || !e.major)) out.push('education details');
  if (p.experience.some((x) => !x.title || !x.company || !x.location || !x.startDate || (!x.current && !x.endDate))) {
    out.push('job details');
  }
  return out;
}

/** Race as checkboxes: pick every race that applies. Forms with one choice get "Two or More Races" when several are picked. */
function RaceField({ value, onChange }: { value: string; onChange: (race: string) => void }) {
  const picked = racesOf(value);
  const toggle = (race: string, on: boolean) => {
    const next = on ? [...picked, race] : picked.filter((r) => r !== race);
    onChange(next.length ? EEO_OPTIONS.race.filter((r) => next.includes(r)).join('; ') : DECLINE);
  };
  return (
    <fieldset className="sm:col-span-2">
      <legend className="mb-1.5 text-sm font-medium text-slate-800">Race (Select All That Apply)</legend>
      <div className="grid gap-1.5 sm:grid-flow-col sm:grid-cols-2 sm:grid-rows-4">
        {EEO_OPTIONS.race
          .filter((r) => r !== DECLINE)
          .map((race) => (
            <label key={race} className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={picked.includes(race)} onChange={(e) => toggle(race, e.target.checked)} />
              {race}
            </label>
          ))}
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={!picked.length} onChange={(e) => e.target.checked && onChange(DECLINE)} />
          {DECLINE}
        </label>
      </div>
    </fieldset>
  );
}
