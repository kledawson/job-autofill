import { browser } from 'wxt/browser';
import type { ApplicationStatus, Platform, Profile } from './types';
import type { PublicSettings } from './settings';
import type { JobDetails } from './job-details';
import type { ResumeDraft } from './resume';
import type { CapturedAnswer, MappingDraft, RememberedMapping, ReviewField, SavedField } from './remembered-mappings';

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
  /** Set when free responses are drafted on a chat website instead of the Gemini API: its display name. */
  chatProvider?: string;
  /** 'none' when the person answers free responses themselves: no AI writes them. */
  freeResponses?: 'none';
  runId?: string;
  queue?: { token: string; itemId: string; attempt: string };
  preset?: Pick<import('./presets').ApplicationPreset, 'id' | 'name' | 'revision' | 'emphasis' | 'responses' | 'links'>;
}

export interface AnswerRequest {
  runId?: string;
  question: string;
  characterLimit: number;
  company: string;
  role: string;
  jobDescription: string;
  /** The job posting's address (http/https), when known. */
  jobUrl?: string;
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
  tone: 'working' | 'done' | 'attention';
}

/** Session-storage key holding a tab's {@link PageStatus} plus the page origin it was set on. */
export const pageStatusKey = (tabId: number) => `pageStatus:${tabId}`;

/**
 * The free response being drafted on a chat website, kept in session storage (extension pages only) so the
 * side panel can show it on every tab until the answer is used or the draft is cancelled. One at a time.
 */
export interface ChatDraft {
  id: string;
  applicationId: number;
  /** The free responses this prompt asks for, in prompt order. Answered ones are removed. */
  questions: { token: string; question: string; required: boolean; /** Its number in the prompt. */ number: number }[];
  /** True when the prompt asked for several numbered answers at once. */
  batch?: boolean;
  company: string;
  role: string;
  provider: import('./chat-providers').ChatProviderId;
  prompt: string;
  /** Whether the prompt is being put in the chat's message box (the site permission was granted). */
  inserting?: boolean;
  /** What happened in the chat tab: set once the prompt was put in its message box or could not be. */
  insertResult?: import('./chat-providers').InsertResult;
  createdAt: number;
}
export const CHAT_DRAFT_KEY = 'chatDraft';
/** Session-storage key marking a chat tab that should receive the draft's prompt once it loads. */
export const chatInsertKey = (tabId: number) => `chatInsert:${tabId}`;

export type Result<T = {}> = ({ ok: true } & T) | { ok: false; error: string };

/** Messages handled by the background worker, with their response types. */
export interface BackgroundMessages {
  // From the content script
  getFillContext: { req: { runId?: string }; res: FillContext };
  generateAnswer: { req: AnswerRequest; res: Result<{ answer: string }> };
  /** Matches questions no rule recognised to profile keys (null when none fits). */
  mapFields: { req: { fields: FieldQuestion[] }; res: Result<{ keys: (string | null)[] }> };
  /** Whether another frame of this tab started filling recently (a form inside an embedded frame). */
  frameFilling: { req: {}; res: { active: boolean } };
  fillStarted: {
    req: { url: string; company: string; role: string; platform: Platform; runId?: string };
    res: { applicationId: number };
  };
  fillFinished: {
    req: {
      applicationId: number;
      runId?: string;
      company: string;
      role: string;
      filledCount: number;
      aiAnswers: number;
      missingLabels: string[];
      missingQuestions?: (string | null)[];
      reviewFields?: ReviewField[];
      fieldFeedback?: import('./field-feedback').FieldFeedback[];
      memoryQuestions?: string[];
      usedMappingIds?: number[];
      location?: string;
      workMode?: string;
      basePay?: string;
    };
    res: {};
  };
  /** Replaces this tab's status in the side panel. */
  setPageStatus: { req: { status: PageStatus; origin: string }; res: {} };
  jobDescription: { req: { platform: 'lever' | 'ashby'; org: string; jobId: string }; res: string };
  /** Location and work model from the platform's public posting API, for apply pages that don't show them. */
  jobDetails: { req: { platform: 'lever' | 'ashby'; org: string; jobId: string }; res: JobDetails };
  /** Tabs opened from a pasted link are marked pending; `commit` consumes the mark. */
  claimPendingFill: { req: { commit: boolean }; res: { fill: boolean; queued?: boolean; runId?: string; resumeUntil?: number } };
  queueOpening: { req: { attempt: string }; res: Result };
  queueFinished: { req: { runId: string; applicationId?: number; note?: string }; res: Result };
  queueWaiting: { req: { runId: string; reason: import('./application-queue').QueueWaitReason }; res: Result };
  queueSubmitIntent: { req: { runId: string }; res: Result };
  submissionIntent: { req: { runId: string }; res: Result };
  submissionContext: { req: {}; res: Result<{ runId?: string }> };
  submissionConfirmed: { req: { runId: string }; res: Result };
  submissionBlocked: { req: { runId: string }; res: Result };
  queueSubmissionContext: { req: {}; res: Result<{ runId?: string }> };
  queueSubmissionConfirmed: { req: { runId: string }; res: Result };
  getQueue: { req: {}; res: Result<{ queue: (import('./application-queue').QueueState & { presetName: string; resumeName?: string }) | null }> };
  startQueue: { req: { urls: string[]; batchSize: number; presetId?: string; mode?: 'batch' | 'continuous'; autoDetectSubmission?: boolean; resumeApplicationIds?: number[] }; res: Result };
  addQueueLinks: { req: { token: string; urls: string[]; resumeApplicationIds?: number[] }; res: Result<{ added: number; excluded: number }> };
  controlQueue: { req: { token: string; action: 'pause' | 'resume' | 'stop' | 'size'; batchSize?: number }; res: Result };
  queueAction: { req: { token: string; itemId: string; action: 'open' | 'retry' | 'review' | 'submitted' | 'skip' }; res: Result };
  // From extension pages
  /** Opens a job link and fills it. Links outside the known job sites need the all-sites permission first. */
  startFill: {
    req: { url: string; force?: boolean; presetId?: string };
    res: Result<{ duplicate?: { filledAt: number; status: string } }>;
  };
  fillActiveTab: { req: { presetId?: string }; res: Result };
  getRememberedMappings: { req: { questions: string[] }; res: Result<{ mappings: RememberedMapping[] }> };
  matchSavedAnswers: { req: { fields: SavedField[]; runId?: string }; res: Result<{ matches: { mapping: RememberedMapping | null; suggestionId?: number; reason: string }[] }> };
  capturePageAnswer: { req: { applicationId: number; token: string; suggestionId?: number }; res: Result<{ capture: CapturedAnswer; suggestion?: RememberedMapping }> };
  showApplicationField: { req: { applicationId: number; token: string }; res: Result };
  capturePageAnswers: { req: { applicationId: number; tokens: string[] }; res: Result<{ captures: CapturedAnswer[]; skipped: { label: string; reason: string }[] }> };
  savePageAnswers: { req: { applicationId: number; entries: { token: string; captureId: string; mapping?: MappingDraft; profile?: import('./profile-learning').ProfileConfirmation }[] }; res: Result<{ count: number; profileCount: number; note: string }> };
  /** Builds the prompt for one free response and makes it the active {@link ChatDraft}. */
  startChatDraft: { req: { applicationId: number; tokens: string[] }; res: Result<{ draft: ChatDraft }> };
  /** Opens the active draft's chat website in a new tab, putting the prompt in its message box when allowed. */
  openChatDraft: { req: { draftId: string }; res: Result<{ inserting: boolean }> };
  /** Writes the replies the person pasted into the draft's fields, then returns to the application tab. */
  useChatAnswer: { req: { draftId: string; answers: { token: string; answer: string }[] }; res: Result<{ results: { token: string; ok: boolean; note: string }[] }> };
  cancelChatDraft: { req: { draftId: string }; res: Result };
  applySavedAnswer: { req: { applicationId: number; token: string; captureId: string; mappingId: number }; res: Result<{ note: string }> };
  suggestAnswerWordings: { req: { question: string }; res: Result<{ aliases: string[] }> };
  saveRememberedMapping: { req: { mapping: MappingDraft; id?: number }; res: Result<{ id: number }> };
  removeRememberedMapping: { req: { id: number }; res: Result };
  markSubmitted: { req: { applicationId: number }; res: Result };
  closeSubmittedTab: { req: { applicationId: number }; res: Result };
  retrySheet: { req: { applicationId: number }; res: Result };
  /** Records an application that has nothing to autofill (e.g. a one-click apply) as submitted and adds it to the sheet. */
  /** Removes the application from the extension's list only; the Google Sheet is never touched. */
  deleteApplication: { req: { applicationId: number }; res: Result };
  /** Removes every application, or only those with `status` when given. */
  clearApplications: { req: { status?: ApplicationStatus }; res: Result };
  trackApplication: { req: { url: string }; res: Result<{ applicationId: number; note: string; sheetRow?: number; sheetError?: string }> };
  setGeminiKey: { req: { apiKey: string }; res: {} };
  testGemini: { req: { apiKey?: string; model?: string }; res: Result };
  /** Reads the uploaded resume with Gemini. Returns validated draft fields; the caller merges them. */
  parseResume: {
    /** Text read locally from the PDF (faster); omit to send the PDF itself, e.g. for scanned resumes. */
    req: { text?: string; sections?: ('education' | 'experience' | 'skills')[] };
    res: Result<{ draft: ResumeDraft }>;
  };
  /** Links the spreadsheet at `url` after checking the signed-in Google account can open it. */
  connectSheets: { req: { url: string }; res: Result<{ sheetUrl: string }> };
  testSheets: { req: {}; res: Result<{ tab: string; columns: string[] }> };
  disconnectSheets: { req: {}; res: {} };
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
export type ContentMessage = { type: 'fill'; applicationId?: number; runId?: string } | { type: 'cancelQueue'; runId?: string; wait?: boolean } | { type: 'reviewNow'; runId: string } | { type: 'ping' } | { type: 'readPosting' } |
  { type: 'checkSubmission' } |
  { type: 'showField'; token: string; question: string; runId?: string } |
  { type: 'captureAnswer'; token: string; question: string } |
  { type: 'captureAnswers'; fields: { token: string; label: string }[] } |
  { type: 'validateCaptures'; entries: { token: string; captureId: string }[] } |
  { type: 'finishRemembering'; entries: { token: string; captureId: string }[] } |
  { type: 'applyAnswer'; token: string; captureId: string; mapping: RememberedMapping } |
  { type: 'draftRequest'; token: string; question: string; runId?: string } |
  { type: 'applyDraft'; token: string; question: string; text: string; runId?: string };

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
