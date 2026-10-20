import type { Profile } from './types';

export const PROMPT_PLACEHOLDERS = [
  '{question}',
  '{jobDescription}',
  '{company}',
  '{role}',
  '{profile}',
  '{characterLimit}',
  '{jobUrl}',
] as const;

export const DEFAULT_PROMPT_TEMPLATE = `You are filling out a job application on behalf of the candidate described below. Write the candidate's answer to one application question.

Company: {company}
Role: {role}
Job posting: {jobUrl}

Question:
{question}

Job description (copied from the posting):
{jobDescription}

Candidate profile:
{profile}

Rules:
- Write in the first person, as the candidate, in a warm and specific but professional voice.
- Only mention employers, schools, projects, skills, and numbers that appear in the candidate profile. Never invent experience, metrics, or credentials.
- Connect the candidate's real experience to what the job description asks for.
- Write 3 to 5 sentences, unless the question asks for a different length.
- Stay under the question's character limit.
- Output only the answer as plain text: no markdown, no headings, no placeholders, no preamble.`;

const INTERIM_DEFAULT_PROMPT_TEMPLATE = `You are filling out a job application on behalf of the candidate described below. Write the candidate's answer to one application question.

Company: {company}
Role: {role}
Job posting: {jobUrl}

Question:
{question}

Job description (copied from the posting):
{jobDescription}

Candidate profile:
{profile}

Rules:
- Write in the first person, as the candidate, in a warm and specific but professional voice.
- Only mention employers, schools, projects, skills, and numbers that appear in the candidate profile. Never invent experience, metrics, or credentials.
- Connect the candidate's real experience to what the job description asks for.
- Write 3 to 5 sentences, unless the question asks for a different length.
- Stay under the question's character limit of {characterLimit} characters.
- Output only the answer as plain text: no markdown, no headings, no placeholders, no preamble.`;

/** The default before the posting link and the 3–5 sentence rule; a saved copy of it is upgraded. */
export const PREVIOUS_DEFAULT_PROMPT_TEMPLATE = `You are filling out a job application on behalf of the candidate described below. Write the candidate's answer to one application question.

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
  /** The job posting's address, when known. */
  jobUrl?: string;
}

export function renderPrompt(template: string, ctx: PromptContext, profile: Profile): string {
  const values: Record<string, string> = {
    '{question}': ctx.question,
    '{jobDescription}': ctx.jobDescription.trim() || '(not available)',
    '{company}': ctx.company || '(unknown company)',
    '{role}': ctx.role || '(unknown role)',
    '{profile}': profileForPrompt(profile),
    '{characterLimit}': String(ctx.characterLimit),
    '{jobUrl}': ctx.jobUrl || '(not available)',
  };
  const rendered = template.replace(/\{(question|jobDescription|company|role|profile|characterLimit|jobUrl)\}/g, (m) => values[m] ?? m);
  // A template written before {jobUrl} existed still names the posting, so a chat assistant can open it.
  return ctx.jobUrl && !template.includes('{jobUrl}') ? `${rendered}\n\nJob posting: ${ctx.jobUrl}` : rendered;
}

/**
 * Plain-text profile summary for Gemini. Voluntary disclosures (gender, race,
 * veteran, disability) and contact details are deliberately left out.
 */
export function profileForPrompt(p: Profile): string {
  const lines: string[] = [];
  const name = [p.preferredName || p.firstName, p.lastName].filter(Boolean).join(' ');
  if (name) lines.push(`Name: ${name}`);
  if (p.currentTitle) lines.push(`Current position: ${p.currentTitle}`);
  if (p.currentCompany) lines.push(`Current company: ${p.currentCompany}`);
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
  const clean = text.replace(/\*\*/g, '').replace(/^\s*(answer|response)\s*:\s*/i, '').trim();
  if (clean.length <= limit) return clean;
  const cut = clean.slice(0, limit);
  // One character more, so a sentence that ends exactly at the limit counts.
  const ahead = clean.slice(0, limit + 1);
  const lastStop = Math.max(ahead.lastIndexOf('. '), ahead.lastIndexOf('! '), ahead.lastIndexOf('? '));
  if (lastStop > limit * 0.4) return cut.slice(0, lastStop + 1);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).replace(/[,;:]$/, '');
}

export interface BatchQuestion {
  question: string;
  characterLimit: number;
}

/**
 * One prompt for several free responses on the same application: the person's template with the questions
 * numbered in place of {question}, plus a reply format that {@link splitBatchReply} can take apart.
 */
export function renderBatchPrompt(template: string, questions: BatchQuestion[], ctx: Omit<PromptContext, 'question' | 'characterLimit'>, profile: Profile): string {
  const list = questions.map((q, i) => `${i + 1}. ${q.question}`).join('\n');
  const limit = Math.min(...questions.map(q => q.characterLimit));
  const example = questions.map((_, i) => `Answer ${i + 1}\n<your answer to question ${i + 1}>`).join('\n\n');
  return renderPrompt(template, { ...ctx, question: list, characterLimit: limit }, profile) +
    `\n\nThere are ${questions.length} questions above. Write a separate answer to each one, following the rules above for every answer and keeping each under its question's character limit. ` +
    `Format the reply exactly like this, with each marker on its own line and nothing before the first marker:\n\n${example}`;
}

const ANSWER_MARKER = /^[\s>#*_=-]*answer\s+(\d{1,2})\b[\s:.)*_=-]*$/gim;

/** The answers in a reply to {@link renderBatchPrompt}, by question number; '' where an answer is missing. */
export function splitBatchReply(text: string, count: number): string[] {
  const answers = Array.from({ length: count }, () => '');
  const marks = [...text.matchAll(ANSWER_MARKER)];
  marks.forEach((m, i) => {
    const n = Number(m[1]);
    if (n < 1 || n > count || answers[n - 1]) return;
    const end = i + 1 < marks.length ? marks[i + 1]!.index! : text.length;
    answers[n - 1] = text.slice(m.index! + m[0].length, end).trim();
  });
  return answers;
}

/** Earlier built-in defaults; a template saved unchanged from one of them follows the current default. */
export function isPreviousDefaultTemplate(template: string): boolean {
  return template === PREVIOUS_DEFAULT_PROMPT_TEMPLATE || template === INTERIM_DEFAULT_PROMPT_TEMPLATE;
}
