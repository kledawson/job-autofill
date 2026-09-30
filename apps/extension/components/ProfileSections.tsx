import { useState } from 'react';
import { DECLINE, emptyEducation, emptyExperience, type Education, type Experience, type Profile } from '@/lib/types';
import { Button, Card, Field, Grid, Input, Select, Textarea } from './ui';

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
    DECLINE,
    'American Indian or Alaska Native',
    'Asian',
    'Black or African American',
    'Native Hawaiian or Other Pacific Islander',
    'White',
    'Two or More Races',
  ],
  hispanic: [DECLINE, 'Yes', 'No'],
  veteran: [
    DECLINE,
    'I am not a protected veteran',
    'I identify as one or more of the classifications of protected veteran',
  ],
  disability: [DECLINE, 'No, I do not have a disability', 'Yes, I have a disability (or previously had a disability)'],
};

export function BasicsSection({ profile: p, onChange }: SectionProps) {
  const set = (patch: Partial<Profile>) => onChange({ ...p, ...patch });
  return (
    <Card title="About you" description="Used for name, contact, and address fields.">
      <div className="space-y-4">
        <Grid>
          <Field label="First name" required>
            <Input value={p.firstName} onChange={(e) => set({ firstName: e.target.value })} autoComplete="given-name" />
          </Field>
          <Field label="Last name" required>
            <Input value={p.lastName} onChange={(e) => set({ lastName: e.target.value })} autoComplete="family-name" />
          </Field>
          <Field label="Preferred name" hint="Leave blank to use your first name.">
            <Input value={p.preferredName} onChange={(e) => set({ preferredName: e.target.value })} />
          </Field>
          <Field label="Pronouns" hint="Optional.">
            <Input value={p.pronouns} onChange={(e) => set({ pronouns: e.target.value })} placeholder="she/her" />
          </Field>
          <Field label="Email" required>
            <Input type="email" value={p.email} onChange={(e) => set({ email: e.target.value })} autoComplete="email" />
          </Field>
          <Field label="Phone" required>
            <Input type="tel" value={p.phone} onChange={(e) => set({ phone: e.target.value })} autoComplete="tel" />
          </Field>
          <Field label="Current position" hint="Your job title now. Leave blank if you’re not currently working." className="sm:col-span-2">
            <Input
              value={p.currentTitle}
              onChange={(e) => set({ currentTitle: e.target.value })}
              placeholder="Software Engineering Intern"
              autoComplete="organization-title"
            />
          </Field>
        </Grid>
        <Field label="Street address">
          <Input value={p.address} onChange={(e) => set({ address: e.target.value })} autoComplete="street-address" />
        </Field>
        <Grid cols={3}>
          <Field label="City" required>
            <Input value={p.city} onChange={(e) => set({ city: e.target.value })} />
          </Field>
          <Field label="State" required>
            <Input value={p.state} onChange={(e) => set({ state: e.target.value })} placeholder="CA" />
          </Field>
          <Field label="ZIP">
            <Input value={p.zip} onChange={(e) => set({ zip: e.target.value })} />
          </Field>
        </Grid>
        <Field label="Country">
          <Input value={p.country} onChange={(e) => set({ country: e.target.value })} />
        </Field>
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
        <Field label="Personal website">
          <Input value={p.website} onChange={(e) => set({ website: e.target.value })} />
        </Field>
      </Grid>
    </Card>
  );
}

export function WorkAuthSection({ profile: p, onChange }: SectionProps) {
  const set = (patch: Partial<Profile['workAuth']>) => onChange({ ...p, workAuth: { ...p.workAuth, ...patch } });
  return (
    <Card title="Work authorization" description="Answers the standard yes/no eligibility questions.">
      <Grid>
        <Field label="Authorized to work in the US?" required>
          <Select
            options={YES_NO}
            value={p.workAuth.authorizedUS}
            onChange={(e) => set({ authorizedUS: e.target.value as Profile['workAuth']['authorizedUS'] })}
          />
        </Field>
        <Field label="Need sponsorship now or in the future?" required>
          <Select
            options={YES_NO}
            value={p.workAuth.needsSponsorship}
            onChange={(e) => set({ needsSponsorship: e.target.value as Profile['workAuth']['needsSponsorship'] })}
          />
        </Field>
        <Field label="Current status" className="sm:col-span-2">
          <Select
            options={['', 'US Citizen', 'Permanent Resident (Green Card)', 'F-1 (OPT/CPT)', 'H-1B', 'Other visa'].map(
              (o) => [o, o || 'Select…'] as [string, string],
            )}
            value={p.workAuth.status}
            onChange={(e) => set({ status: e.target.value })}
          />
        </Field>
      </Grid>
    </Card>
  );
}

function ListControls({ onRemove, canRemove }: { onRemove: () => void; canRemove: boolean }) {
  return canRemove ? (
    <Button variant="ghost" className="px-2 py-1 text-xs" onClick={onRemove}>
      Remove
    </Button>
  ) : null;
}

export function EducationSection({ profile: p, onChange }: SectionProps) {
  const update = (i: number, patch: Partial<Education>) =>
    onChange({ ...p, education: p.education.map((e, j) => (j === i ? { ...e, ...patch } : e)) });
  return (
    <Card
      title="Education"
      description="The first school is used for application forms. Put your most recent one first."
      actions={
        <Button variant="secondary" onClick={() => onChange({ ...p, education: [...p.education, emptyEducation()] })}>
          Add school
        </Button>
      }
    >
      <div className="space-y-6">
        {p.education.map((e, i) => (
          <div key={i} className={i ? 'border-t border-slate-100 pt-5' : ''}>
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">School {i + 1}</span>
              <ListControls
                canRemove={p.education.length > 1}
                onRemove={() => onChange({ ...p, education: p.education.filter((_, j) => j !== i) })}
              />
            </div>
            <Grid>
              <Field label="School" required={i === 0} className="sm:col-span-2">
                <Input value={e.school} onChange={(ev) => update(i, { school: ev.target.value })} placeholder="University of …" />
              </Field>
              <Field label="Degree">
                <Input value={e.degree} onChange={(ev) => update(i, { degree: ev.target.value })} placeholder="Bachelor of Science" />
              </Field>
              <Field label="Major">
                <Input value={e.major} onChange={(ev) => update(i, { major: ev.target.value })} placeholder="Computer Science" />
              </Field>
              <Field label="Start">
                <Input type="month" value={e.startDate} onChange={(ev) => update(i, { startDate: ev.target.value })} />
              </Field>
              <Field label="End (or expected)">
                <Input type="month" value={e.endDate} onChange={(ev) => update(i, { endDate: ev.target.value })} />
              </Field>
              <Field label="GPA" hint="Optional.">
                <Input value={e.gpa} onChange={(ev) => update(i, { gpa: ev.target.value })} placeholder="3.7" />
              </Field>
              <Field label="Honors" hint="Optional.">
                <Input value={e.honors} onChange={(ev) => update(i, { honors: ev.target.value })} />
              </Field>
            </Grid>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function ExperienceSection({ profile: p, onChange }: SectionProps) {
  const update = (i: number, patch: Partial<Experience>) =>
    onChange({ ...p, experience: p.experience.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const [skillsText, setSkillsText] = useState(p.skills.join(', '));
  return (
    <Card
      title="Experience and skills"
      description="Gemini only draws on what you enter here, so be specific: projects, tools, results."
      actions={
        <Button variant="secondary" onClick={() => onChange({ ...p, experience: [...p.experience, emptyExperience()] })}>
          Add job
        </Button>
      }
    >
      <div className="space-y-6">
        {p.experience.map((x, i) => (
          <div key={i} className={i ? 'border-t border-slate-100 pt-5' : ''}>
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Job {i + 1}</span>
              <ListControls
                canRemove={p.experience.length > 1}
                onRemove={() => onChange({ ...p, experience: p.experience.filter((_, j) => j !== i) })}
              />
            </div>
            <Grid>
              <Field label="Title">
                <Input value={x.title} onChange={(e) => update(i, { title: e.target.value })} placeholder="Software Engineering Intern" />
              </Field>
              <Field label="Company">
                <Input value={x.company} onChange={(e) => update(i, { company: e.target.value })} />
              </Field>
              <Field label="Location">
                <Input value={x.location} onChange={(e) => update(i, { location: e.target.value })} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Start">
                  <Input type="month" value={x.startDate} onChange={(e) => update(i, { startDate: e.target.value })} />
                </Field>
                <Field label="End">
                  <Input
                    type="month"
                    value={x.current ? '' : x.endDate}
                    disabled={x.current}
                    onChange={(e) => update(i, { endDate: e.target.value })}
                  />
                </Field>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2">
                <input
                  type="checkbox"
                  className="size-4 rounded border-slate-300 accent-indigo-600"
                  checked={x.current}
                  onChange={(e) => update(i, { current: e.target.checked, endDate: e.target.checked ? '' : x.endDate })}
                />
                I currently work here
              </label>
              <Field label="What you did" hint="One bullet per line." className="sm:col-span-2">
                <Textarea
                  rows={4}
                  value={x.bullets}
                  onChange={(e) => update(i, { bullets: e.target.value })}
                  placeholder={'Built …\nImproved … by …%'}
                />
              </Field>
            </Grid>
          </div>
        ))}
        <Field label="Skills" hint="Comma-separated: languages, frameworks, tools." className="border-t border-slate-100 pt-5">
          <Input
            value={skillsText}
            onChange={(e) => {
              setSkillsText(e.target.value);
              onChange({ ...p, skills: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) });
            }}
            placeholder="Python, TypeScript, React, SQL"
          />
        </Field>
      </div>
    </Card>
  );
}

export function PreferencesSection({ profile: p, onChange }: SectionProps) {
  const set = (patch: Partial<Profile['preferences']>) => onChange({ ...p, preferences: { ...p.preferences, ...patch } });
  return (
    <Card title="Common questions" description="Answers reused on every application.">
      <Grid>
        <Field label="Desired salary">
          <Input value={p.preferences.salary} onChange={(e) => set({ salary: e.target.value })} placeholder="$120,000" />
        </Field>
        <Field label="Earliest start date">
          <Input value={p.preferences.startDate} onChange={(e) => set({ startDate: e.target.value })} placeholder="June 2026" />
        </Field>
        <Field label="Willing to relocate?">
          <Select
            options={YES_NO}
            value={p.preferences.relocate}
            onChange={(e) => set({ relocate: e.target.value as Profile['preferences']['relocate'] })}
          />
        </Field>
        <Field label="Work arrangement">
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
        <Field label="How did you hear about us? (default answer)" className="sm:col-span-2">
          <Input value={p.preferences.howHeard} onChange={(e) => set({ howHeard: e.target.value })} placeholder="LinkedIn" />
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
      title="Voluntary self-identification"
      description="Optional. Each defaults to “Decline to answer.” These answers only fill matching dropdowns and are never sent to Gemini."
    >
      <Grid>
        <Field label="Gender">
          <Select options={opts(EEO_OPTIONS.gender)} value={p.eeo.gender} onChange={(e) => set({ gender: e.target.value })} />
        </Field>
        <Field label="Hispanic or Latino">
          <Select options={opts(EEO_OPTIONS.hispanic)} value={p.eeo.hispanic} onChange={(e) => set({ hispanic: e.target.value })} />
        </Field>
        <Field label="Race">
          <Select options={opts(EEO_OPTIONS.race)} value={p.eeo.race} onChange={(e) => set({ race: e.target.value })} />
        </Field>
        <Field label="Veteran status">
          <Select options={opts(EEO_OPTIONS.veteran)} value={p.eeo.veteran} onChange={(e) => set({ veteran: e.target.value })} />
        </Field>
        <Field label="Disability status" className="sm:col-span-2">
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
  return out;
}
