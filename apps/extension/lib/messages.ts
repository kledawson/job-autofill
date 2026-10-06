import { browser } from 'wxt/browser';
import type { Platform, Profile } from './types';
import type { PublicSettings } from './settings';
import type { ResumeDraft } from './resume';

export interface FilePayload {
  name: string;
  type: string;
  /** base64, since runtime messages are JSON-serialized and cannot carry Blobs */
  base64: string;
}

export interface FillContext {
  profile: Profile;
  resume: FilePayload | null;
  coverLetter: FilePayload | null;
  transcript: FilePayload | null;
  hasGeminiKey: boolean;
}

export interface AnswerRequest {
  question: string;
  characterLimit: number;
  company: string;
  role: string;
  jobDescription: string;
}

/** A form question sent for AI matching: its wording and choices only, never the person's answers. */
export interface FieldQuestion {
  label: string;
  kind: string;
  options: string[];
  section?: 'experience' | 'education';
}

/** What the content script is doing on a tab, shown in the side panel. Never contains applicant values. */
export interface PageStatus {
  title: string;
  lines: string[];
  tone: 'working' | 'done';
}

/** Session-storage key holding a tab's {@link PageStatus} plus the page origin it was set on. */
export const pageStatusKey = (tabId: number) => `pageStatus:${tabId}`;

export type Result<T = {}> = ({ ok: true } & T) | { ok: false; error: string };

/** Messages handled by the background worker, with their response types. */
export interface BackgroundMessages {
  // From the content script
  getFillContext: { req: {}; res: FillContext };
  generateAnswer: { req: AnswerRequest; res: Result<{ answer: string }> };
  /** Matches questions no rule recognised to profile keys (null when none fits). */
  mapFields: { req: { fields: FieldQuestion[] }; res: Result<{ keys: (string | null)[] }> };
  /** Whether another frame of this tab started filling recently (a form inside an embedded frame). */
  frameFilling: { req: {}; res: { active: boolean } };
  fillStarted: {
    req: { url: string; company: string; role: string; platform: Platform };
    res: { applicationId: number };
  };
  fillFinished: {
    req: {
      applicationId: number;
      company: string;
      role: string;
      filledCount: number;
      aiAnswers: number;
      missingLabels: string[];
    };
    res: {};
  };
  /** Replaces this tab's status in the side panel. */
  setPageStatus: { req: { status: PageStatus; origin: string }; res: {} };
  jobDescription: { req: { platform: 'lever' | 'ashby'; org: string; jobId: string }; res: string };
  /** Tabs opened from a pasted link are marked pending; `commit` consumes the mark. */
  claimPendingFill: { req: { commit: boolean }; res: { fill: boolean } };
  // From extension pages
  /** Opens a job link and fills it. Links outside the known job sites need the all-sites permission first. */
  startFill: {
    req: { url: string; force?: boolean };
    res: Result<{ duplicate?: { filledAt: number; status: string } }>;
  };
  fillActiveTab: { req: {}; res: Result };
  markSubmitted: { req: { applicationId: number }; res: Result };
  setGeminiKey: { req: { apiKey: string }; res: {} };
  testGemini: { req: { apiKey?: string; model?: string }; res: Result };
  /** Reads the uploaded resume with Gemini. Returns validated draft fields; the caller merges them. */
  parseResume: {
    /** Text read locally from the PDF (faster); omit to send the PDF itself, e.g. for scanned resumes. */
    req: { text?: string; sections?: ('education' | 'experience' | 'skills')[] };
    res: Result<{ draft: ResumeDraft }>;
  };
  connectSheets: { req: {}; res: Result<{ sheetUrl: string }> };
  getPublicSettings: { req: {}; res: PublicSettings };
  deleteAllData: { req: {}; res: {} };
}

export type BackgroundMessage = {
  [K in keyof BackgroundMessages]: { type: K } & BackgroundMessages[K]['req'];
}[keyof BackgroundMessages];

export function sendToBackground<K extends keyof BackgroundMessages>(
  type: K,
  req: BackgroundMessages[K]['req'],
): Promise<BackgroundMessages[K]['res']> {
  return browser.runtime.sendMessage({ type, ...req });
}

/** Messages handled by the content script. */
export type ContentMessage = { type: 'fill'; applicationId?: number } | { type: 'ping' };

export function fileToPayload(file: { name: string; type: string }, bytes: ArrayBuffer): FilePayload {
  const u8 = new Uint8Array(bytes);
  let binary = '';
  for (let i = 0; i < u8.length; i += 0x8000) {
    binary += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  }
  return { name: file.name, type: file.type, base64: btoa(binary) };
}

export function payloadToFile(p: FilePayload): File {
  const binary = atob(p.base64);
  const u8 = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) u8[i] = binary.charCodeAt(i);
  return new File([u8], p.name, { type: p.type || 'application/pdf' });
}
