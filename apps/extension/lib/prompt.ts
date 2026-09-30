import type { Profile } from './types';

export const PROMPT_PLACEHOLDERS = [
  '{question}',
  '{jobDescription}',
  '{company}',
  '{role}',
  '{profile}',
  '{characterLimit}',
] as const;

export const DEFAULT_PROMPT_TEMPLATE = `You are filling out a job application on behalf of the candidate described below. Write the candidate's answer to one application question.

Company: {company}
Role: {role}

Question:
{question}

Job description:
{jobDescription}

Candidate profile:
{profile}

Rules:
- Write in the first person, as the candidate, in a warm and specific but professional voice.
- Only mention employers, schools, projects, skills, and numbers that appear in the candidate profile. Never invent experience, metrics, or credentials.
- Connect the candidate's real experience to what the job description asks for.
- Match the length to the question: two to four sentences for short questions like "Why this company?", one or two short paragraphs for behavioral questions.
- Stay under {characterLimit} characters.
- Output only the answer as plain text: no markdown, no headings, no placeholders, no preamble.`;

export interface PromptContext {
  question: string;
  jobDescription: string;
  company: string;
  role: string;
  characterLimit: number;
}

export function renderPrompt(template: string, ctx: PromptContext, profile: Profile): string {
  const values: Record<string, string> = {
    '{question}': ctx.question,
    '{jobDescription}': ctx.jobDescription.trim() || '(not available)',
    '{company}': ctx.company || '(unknown company)',
    '{role}': ctx.role || '(unknown role)',
    '{profile}': profileForPrompt(profile),
    '{characterLimit}': String(ctx.characterLimit),
  };
  return template.replace(/\{(question|jobDescription|company|role|profile|characterLimit)\}/g, (m) => values[m] ?? m);
}

/**
 * Plain-text profile summary for Gemini. Voluntary disclosures (gender, race,
 * veteran, disability) and contact details are deliberately left out.
 */
export function profileForPrompt(p: Profile): string {
  const lines: string[] = [];
  const name = [p.preferredName || p.firstName, p.lastName].filter(Boolean).join(' ');
  if (name) lines.push(`Name: ${name}`);
  const location = [p.city, p.state, p.country].filter(Boolean).join(', ');
  if (location) lines.push(`Location: ${location}`);

  const schools = p.education.filter((e) => e.school);
  if (schools.length) {
    lines.push('Education:');
    for (const e of schools) {
      const degree = [e.degree, e.major].filter(Boolean).join(' in ');
      const dates = [e.startDate, e.endDate].filter(Boolean).join(' to ');
      const extras = [e.gpa && `GPA ${e.gpa}`, e.honors].filter(Boolean).join('; ');
      lines.push(`- ${[degree, e.school].filter(Boolean).join(', ')}${dates ? ` (${dates})` : ''}${extras ? `. ${extras}` : ''}`);
    }
  }

  const jobs = p.experience.filter((x) => x.title || x.company);
  if (jobs.length) {
    lines.push('Experience:');
    for (const x of jobs) {
      const dates = [x.startDate, x.current ? 'present' : x.endDate].filter(Boolean).join(' to ');
      lines.push(`- ${[x.title, x.company].filter(Boolean).join(' at ')}${x.location ? `, ${x.location}` : ''}${dates ? ` (${dates})` : ''}`);
      for (const b of x.bullets.split('\n').map((s) => s.replace(/^[-•*\s]+/, '').trim()).filter(Boolean)) {
        lines.push(`  • ${b}`);
      }
    }
  }

  if (p.skills.length) lines.push(`Skills: ${p.skills.join(', ')}`);
  if (p.preferences.workMode) lines.push(`Work preference: ${p.preferences.workMode}`);
  const links = [p.github && `GitHub ${p.github}`, p.portfolio && `Portfolio ${p.portfolio}`].filter(Boolean);
  if (links.length) lines.push(`Links: ${links.join(', ')}`);
  return lines.join('\n');
}

/** Trim a model answer to a hard limit, preferring to cut at a sentence end. */
export function clampToLimit(text: string, limit: number): string {
  const clean = text.replace(/^\s*(answer|response)\s*:\s*/i, '').replace(/\*\*/g, '').trim();
  if (clean.length <= limit) return clean;
  const cut = clean.slice(0, limit);
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (lastStop > limit * 0.4) return cut.slice(0, lastStop + 1);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).replace(/[,;:]$/, '');
}
