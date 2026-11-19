// Background-only Google Docs API calls. The document is changed only after explicit approval.
import { browser } from 'wxt/browser';

export function parseDocsUrl(text: string): string | null {
  try {
    const url = new URL(text.trim());
    if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com') return null;
    return /^\/document\/u\/\d+\/d\/([\w-]+)/.exec(url.pathname)?.[1] ?? /^\/document\/d\/([\w-]+)/.exec(url.pathname)?.[1] ?? null;
  } catch { return null; }
}

export function docsConfigured(): boolean {
  return !!(browser.runtime.getManifest() as { oauth2?: { client_id?: string } }).oauth2?.client_id;
}

async function token(interactive = true): Promise<string> {
  const result = await browser.identity.getAuthToken({ interactive });
  const value = typeof result === 'string' ? result : result?.token;
  if (!value) throw new Error('Google sign-in is required.');
  return value;
}

async function call(id: string, init?: RequestInit, interactive = true) {
  const access = await token(interactive);
  const response = await fetch(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(id)}`, {
    ...init, signal: AbortSignal.timeout(20000),
    headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json', ...init?.headers },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message ?? `Google Docs error ${response.status}`);
  return body;
}

export async function connectDoc(url: string, interactive = true): Promise<{ id: string; url: string; title: string }> {
  const id = parseDocsUrl(url);
  if (!id) throw new Error('Paste a Google Docs document link.');
  const doc = await call(id, undefined, interactive);
  if (!doc?.body?.content) throw new Error('This Google document could not be opened.');
  return { id, url: `https://docs.google.com/document/d/${id}/edit`, title: typeof doc.title === 'string' ? doc.title : 'Google Doc' };
}

const paragraphText = (value: any): string => (value?.paragraph?.elements ?? [])
  .map((item: any) => item?.textRun?.content ?? '').join('').replace(/\n$/, '').trim();
const isGreeting = (text: string) => /^(?:dear\s+.+|hello(?:\s+.+)?|hi\s+.+|to whom it may concern)[,:]?$/i.test(text);
const isClosing = (text: string) => /^(?:sincerely|sincerely yours|respectfully|respectfully yours|regards|best|best regards|all the best|kind regards|warm regards|warmly|yours truly|yours sincerely|faithfully|yours faithfully|cheers|thank you|with gratitude)[,!]?$/i.test(text);
const isHeaderLine = (text: string, index: number) =>
  !text || /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(text) || /https?:\/\//i.test(text) ||
  /^[+\d(][\d ()+.-]{5,}$/.test(text) || (index === 0 && /^[A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+){1,3}$/u.test(text));

function firstBodyParagraphIndex(paragraphs: any[]): number {
  let index = 0;
  while (index < paragraphs.length && index < 10 && isHeaderLine(paragraphText(paragraphs[index]), index)) index++;
  return index;
}

/** Remove optional salutation/closing from an LLM reply and normalize it to plain paragraphs. */
export function coverLetterBody(text: string): string {
  const lines = text.replace(/\r/g, '').split('\n').map(line => line.trim()).filter(Boolean);
  const greeting = lines.findIndex(isGreeting);
  const start = greeting >= 0 ? greeting + 1 : 0;
  const closing = lines.findIndex((line, index) => index >= start && isClosing(line));
  const body = lines.slice(start, closing >= 0 ? closing : undefined)
    .map(line => line.replace(/\*\*(.*?)\*\*/g, '$1').replace(/__(.*?)__/g, '$1'))
    .filter(Boolean);
  return body.join('\n');
}

/** Replace body paragraphs while preserving existing greeting/close and their surrounding document content. */
export async function replaceDocText(id: string, text: string, signatureName = ''): Promise<void> {
  const bodyText = coverLetterBody(text);
  if (!bodyText) throw new Error('The draft has no cover-letter body paragraphs to insert.');
  const doc = await call(id);
  const elements: any[] = doc.body?.content ?? [];
  const paragraphs = elements.filter(element => element?.paragraph && Number.isInteger(element.startIndex) && Number.isInteger(element.endIndex));
  if (!paragraphs.length) throw new Error('The connected Google Doc has no editable paragraphs.');
  const greetingIndex = paragraphs.findIndex(element => isGreeting(paragraphText(element)));
  const closingIndex = paragraphs.findIndex((element, index) => index > greetingIndex && isClosing(paragraphText(element)));
  const firstBody = firstBodyParagraphIndex(paragraphs);
  const lastIndex = paragraphs.length - 1;
  const noExistingBody = greetingIndex < 0 && firstBody >= paragraphs.length;
  const startIndex = greetingIndex >= 0 ? paragraphs[greetingIndex]!.endIndex : noExistingBody ? paragraphs[lastIndex]!.endIndex - 1 : paragraphs[firstBody]!.startIndex;
  const endIndex = closingIndex >= 0 ? paragraphs[closingIndex]!.startIndex : paragraphs[lastIndex]!.endIndex - 1;
  if (endIndex < startIndex) throw new Error('Could not identify a replaceable cover-letter body in the connected Google Doc.');
  const oldBodyParagraph = paragraphs.find(element => element.startIndex >= startIndex && element.endIndex <= endIndex);
  const textRun = oldBodyParagraph?.paragraph?.elements?.find((element: any) => element?.textRun)?.textRun;
  const sampleTextStyle = textRun?.textStyle ?? {};
  const sampleParagraphStyle = oldBodyParagraph?.paragraph?.paragraphStyle ?? {};
  const namedType = sampleParagraphStyle.namedStyleType ?? 'NORMAL_TEXT';
  const namedParagraphStyle = doc.namedStyles?.styles?.find((style: any) => style.namedStyleType === namedType)?.paragraphStyle ??
    doc.namedStyles?.styles?.find((style: any) => style.namedStyleType === 'NORMAL_TEXT')?.paragraphStyle ?? {};
  const leadingBreak = noExistingBody && paragraphText(paragraphs[lastIndex]) ? '\n' : '';
  const inserted = `${greetingIndex < 0 ? `${leadingBreak}Dear Hiring Manager,\n` : ''}${bodyText}\n${closingIndex < 0 ? `Sincerely,\n${signatureName ? `${signatureName}\n` : ''}` : ''}`;
  const closingParagraph = closingIndex >= 0 ? paragraphs[closingIndex]! : undefined;
  const existingSignature = closingIndex >= 0
    ? paragraphs.slice(closingIndex + 1).map(paragraphText).find(Boolean) ?? ''
    : '';
  const addSignatureAfterClosing = !!(closingParagraph && signatureName && existingSignature.toLocaleLowerCase() !== signatureName.toLocaleLowerCase());
  const requests: any[] = [];
  if (endIndex > startIndex) requests.push({ deleteContentRange: { range: { startIndex, endIndex } } });
  requests.push({ insertText: { location: { index: startIndex }, text: inserted } });
  const textStyle: Record<string, unknown> = {
    bold: sampleTextStyle.bold ?? false,
    italic: sampleTextStyle.italic ?? false,
    underline: sampleTextStyle.underline ?? false,
    strikethrough: sampleTextStyle.strikethrough ?? false,
  };
  const styleFields = ['weightedFontFamily', 'fontSize', 'foregroundColor', 'backgroundColor', 'baselineOffset'] as const;
  for (const field of styleFields) if (sampleTextStyle[field] !== undefined) textStyle[field] = sampleTextStyle[field];
  requests.push({ updateTextStyle: {
    range: { startIndex, endIndex: startIndex + inserted.length - 1 }, textStyle,
    fields: ['bold', 'italic', 'underline', 'strikethrough', ...styleFields.filter(field => textStyle[field] !== undefined)].join(','),
  } });
  const paragraphStyle: Record<string, unknown> = {
    alignment: sampleParagraphStyle.alignment ?? 'START',
    lineSpacing: sampleParagraphStyle.lineSpacing ?? namedParagraphStyle.lineSpacing ?? 100,
    spaceAbove: sampleParagraphStyle.spaceAbove ?? namedParagraphStyle.spaceAbove ?? { magnitude: 0, unit: 'PT' },
    spaceBelow: sampleParagraphStyle.spaceBelow ?? namedParagraphStyle.spaceBelow ?? { magnitude: 0, unit: 'PT' },
  };
  for (const field of ['indentStart', 'indentEnd', 'indentFirstLine'] as const) {
    if (sampleParagraphStyle[field] !== undefined) paragraphStyle[field] = sampleParagraphStyle[field];
  }
  requests.push({ updateParagraphStyle: {
    range: { startIndex, endIndex: startIndex + inserted.length }, paragraphStyle,
    fields: Object.keys(paragraphStyle).join(','),
  } });
  if (addSignatureAfterClosing && closingParagraph) {
    const shiftedClosingEnd = closingParagraph.endIndex + inserted.length - (endIndex - startIndex);
    requests.push({ insertText: { location: { index: shiftedClosingEnd - 1 }, text: `\n${signatureName}` } });
  }
  const access = await token();
  const response = await fetch(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(id)}:batchUpdate`, {
    method: 'POST', signal: AbortSignal.timeout(20000),
    headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json' },
    body: JSON.stringify({ requests }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error?.message ?? `Google Docs error ${response.status}`);
}
