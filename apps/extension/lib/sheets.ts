// Background worker only. Uses chrome.identity with the spreadsheets scope, so the
// extension can read and edit the spreadsheet the person links.
import { browser } from 'wxt/browser';
import type { Application } from './types';
import { jobKey, postingUrl } from './platforms';

const API = 'https://sheets.googleapis.com/v4/spreadsheets';

export type SheetColumn = 'company' | 'role' | 'dateApplied' | 'jobUrl' | 'location' | 'workModel' | 'basePay' | 'status' | 'found';

/** What can be saved per application. A new, empty sheet gets a header for each entry unless `skipOnNewSheet`. */
export const SHEET_COLUMNS: { key: SheetColumn; label: string; skipOnNewSheet?: boolean }[] = [
  { key: 'company', label: 'Company Name' },
  { key: 'role', label: 'Position' },
  { key: 'dateApplied', label: 'Date Applied' },
  { key: 'jobUrl', label: 'Job Posting URL' },
  { key: 'location', label: 'Location' },
  { key: 'workModel', label: 'Work Model' },
  { key: 'basePay', label: 'Base Pay' },
  { key: 'status', label: 'Application Status' },
  // Same date as Date Applied, for trackers that also have a "Found" column.
  { key: 'found', label: 'Found', skipOnNewSheet: true },
];
const ALL_KEYS = SHEET_COLUMNS.map((c) => c.key);
const NEW_SHEET_COLUMNS = SHEET_COLUMNS.filter((c) => !c.skipOnNewSheet);

/** The spreadsheet ID from a docs.google.com/spreadsheets link, or null for anything else. */
export function parseSheetUrl(text: string): string | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com') return null;
  return /^\/spreadsheets\/(?:u\/\d+\/)?d\/([\w-]+)/.exec(url.pathname)?.[1] ?? null;
}

export function sheetsConfigured(): boolean {
  return !!(browser.runtime.getManifest() as { oauth2?: { client_id?: string } }).oauth2?.client_id;
}

async function getToken(interactive: boolean): Promise<string> {
  // A stalled noninteractive token lookup must not hold every following sheet write.
  const res = interactive ? await browser.identity.getAuthToken({ interactive }) : await new Promise<{ token?: string } | string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Google sign-in timed out. Reconnect your sheet and retry.')), 20000);
    browser.identity.getAuthToken({ interactive }).then(resolve, reject).finally(() => clearTimeout(timer));
  });
  const token = typeof res === 'string' ? res : res?.token;
  if (!token) throw new Error('Not signed in to Google.');
  return token;
}

async function request(path: string, init: RequestInit, interactive = false): Promise<any> {
  let token = await getToken(interactive);
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${API}${path}`, {
      ...init,
      signal: AbortSignal.timeout(20000),
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    });
    if (res.status === 401 && attempt === 0) {
      await browser.identity.removeCachedAuthToken({ token });
      token = await getToken(interactive);
      continue;
    }
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.error?.message ?? `Google Sheets error ${res.status}`);
    return body;
  }
}

const quoteTab = (title: string) => `'${title.replace(/'/g, "''")}'`;

/** Stable numeric tab ID in the query/fragment; invalid explicit IDs never fall back silently. */
export function sheetTabId(text: string): number | undefined {
  const url = new URL(text);
  const raw = url.searchParams.get('gid') ?? new URLSearchParams(url.hash.slice(1)).get('gid');
  if (raw === null) return undefined;
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new Error('The sheet tab ID is invalid. Copy its link again.');
  return Number(raw);
}
export async function openSheet(sheetId: string, interactive = false, tabId?: number): Promise<{ url: string; tab: string; tabId: number }> {
  const body = await request('/' + sheetId + '?fields=spreadsheetUrl,sheets.properties(title,sheetId)', { method: 'GET' }, interactive);
  const tabs = body?.sheets ?? [];
  const chosen = tabId === undefined ? tabs[0]?.properties : tabs.find((t: any) => t.properties?.sheetId === tabId)?.properties;
  if (!chosen || typeof chosen.title !== 'string' || !Number.isSafeInteger(chosen.sheetId)) throw new Error(tabId === undefined ? 'That spreadsheet has no tabs.' : 'The selected sheet tab no longer exists. Reconnect using the correct tab link.');
  const url = new URL(body.spreadsheetUrl); url.hash = 'gid=' + chosen.sheetId;
  return { url: url.href, tab: chosen.title, tabId: chosen.sheetId };
}
/** Read-only test, using the same OAuth and tab resolution as submission writes. */
export async function testSheetConnection(sheetId: string, tabId?: number) {
  const sheet = await openSheet(sheetId, true, tabId);
  const top = await request('/' + sheetId + '/values/' + encodeURIComponent(quoteTab(sheet.tab)) + '!A1:AZ10?valueRenderOption=FORMULA', { method: 'GET' });
  const grid: string[][] = top?.values ?? [];
  const headers = grid.find(r => r.filter(c => String(c).trim()).length >= 2) ?? grid.find(r => r.some(c => String(c).trim())) ?? [];
  const sample = { company: '', role: '', url: '', filledAt: 0, status: 'Submitted', platform: 'other', jobKey: '', aiAnswers: 0, filledCount: 0, missingCount: 0, missingLabels: [] } as Application;
  const columns = planRow(headers, sample).map(c => c.key);
  if (headers.length && !columns.includes('jobUrl')) throw new Error('Add a Job Posting URL column so retries can find an existing application without duplicating it.');
  return { ...sheet, columns };
}

/** Prevent page text like "=IMPORTXML(...)" from being evaluated as a formula. */
function safe(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function day(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function cell(app: Application, key: SheetColumn): string {
  switch (key) {
    case 'company':
      return app.company;
    case 'role':
      return app.role;
    case 'dateApplied':
      return day(app.submittedAt ?? Date.now());
    case 'jobUrl':
      return postingUrl(app.url);
    case 'location':
      return app.location ?? '';
    case 'workModel':
      return app.workMode ?? '';
    case 'basePay':
      return app.basePay ?? '';
    case 'status':
      return 'Applied';
    case 'found':
      return day(app.submittedAt ?? Date.now());
  }
}

export function rowFor(app: Application, columns: SheetColumn[]): string[] {
  return columns.map((key) => safe(cell(app, key)));
}

/** Header wording people use for each detail, compared after lowercasing and dropping punctuation. */
const HEADER_NAMES: Record<SheetColumn, string[]> = {
  company: ['company', 'companyname', 'employer', 'organization', 'organisation', 'firm'],
  role: ['position', 'role', 'title', 'jobtitle', 'positiontitle', 'jobposition', 'positionname', 'rolename'],
  dateApplied: ['dateapplied', 'applieddate', 'applicationdate', 'dateofapplication', 'dateapplication', 'applied', 'date', 'datesubmitted', 'submitted'],
  jobUrl: ['link', 'url', 'joblink', 'joburl', 'jobposting', 'jobpostingurl', 'jobpostinglink', 'posting', 'postingurl', 'postinglink', 'applicationlink', 'applicationurl', 'weblink'],
  location: ['location', 'citystate', 'joblocation', 'city', 'office', 'locationcitystate'],
  basePay: ['basepay', 'salary', 'payrange', 'salaryrange', 'basesalary', 'compensation', 'basecompensation', 'payrate', 'pay'],
  status: ['applicationstatus', 'status', 'applicationstage'],
  found: ['found', 'datefound', 'founddate', 'dateadded', 'foundon'],
  workModel: ['workmodel', 'worktype', 'workmode', 'workarrangement', 'workstyle', 'remote', 'remotehybridonsite', 'onsiteremote', 'remotestatus', 'arrangement', 'setting'],
};

/** Short, generic names: only an exact header counts, so "Last status update" is never mistaken for "Status". */
const EXACT_ONLY = new Set<SheetColumn>(['status', 'found']);

const simplify = (header: string) => header.toLowerCase().replace(/[^a-z0-9]/g, '');

/** How well a header names a detail: earlier names in the list are closer matches; containing one scores lowest. */
function headerScore(header: string, key: SheetColumn): number {
  const h = simplify(header);
  if (!h) return 0;
  const names = HEADER_NAMES[key];
  const exact = names.indexOf(h);
  if (exact >= 0) return 100 - exact;
  if (EXACT_ONLY.has(key)) return 0;
  return names.some((n) => n.length >= 5 && h.includes(n)) ? 1 : 0;
}

/**
 * Finds the existing header that names each detail, whatever the column order. Details with no matching
 * header are skipped; unrelated columns (Status, Referral, ...) are never touched.
 */
export function planRow(headers: string[], app: Application): { index: number; key: SheetColumn; value: string }[] {
  const taken = new Set<number>();
  const cells: { index: number; key: SheetColumn; value: string }[] = [];
  for (const key of ALL_KEYS) {
    let best = -1;
    let bestScore = 0;
    headers.forEach((h, i) => {
      const score = taken.has(i) ? 0 : headerScore(h, key);
      if (score > bestScore) {
        best = i;
        bestScore = score;
      }
    });
    if (best >= 0) {
      taken.add(best);
      cells.push({ index: best, key, value: safe(cell(app, key)) });
    }
  }
  return cells;
}

/** 0 → A, 25 → Z, 26 → AA. */
export function columnLetter(index: number): string {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/**
 * The 0-based index of the first row (counting from the row after the headers) where none of the
 * target columns has anything in it: an unused row inside the table, or the row after its last one.
 */
export function firstEmptyRow(rows: string[][], targets: number[], firstCol: number): number {
  const i = rows.findIndex((r) => targets.every((t) => !String(r[firstCol + t] ?? '').trim()));
  return i >= 0 ? i : rows.length;
}

/**
 * Adds the application to the selected tab, in the topmost row with no company or position, with each
 * detail under the header that names it. Other cells in the row are left alone (dropdowns, defaults).
 * An empty sheet gets a header row first. Returns the 1-based row number.
 */
export async function appendApplication(sheetId: string, app: Application, tabId?: number): Promise<number> {
  const { tab } = await openSheet(sheetId, false, tabId);
  const sheet = encodeURIComponent(quoteTab(tab));
  const write = (data: { range: string; values: string[][] }[]) =>
    request(`/${sheetId}/values:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({
        valueInputOption: 'USER_ENTERED',
        data: data.map((d) => ({ range: `${quoteTab(tab)}!${d.range}`, values: d.values })),
      }),
    });

  const top = await request(`/${sheetId}/values/${sheet}!A1:AZ10?valueRenderOption=FORMULA`, { method: 'GET' });
  const grid: string[][] = top?.values ?? [];
  const filled = (r: string[]) => r.filter((c) => String(c).trim()).length;
  let headerAt = grid.findIndex((r) => filled(r) >= 2);
  if (headerAt < 0) headerAt = grid.findIndex((r) => filled(r) >= 1);

  if (headerAt < 0) {
    await write([{ range: 'A1', values: [NEW_SHEET_COLUMNS.map((c) => c.label), rowFor(app, NEW_SHEET_COLUMNS.map((c) => c.key))] }]);
    return 2;
  }

  const line = grid[headerAt]!.map(String);
  const firstCol = Math.max(0, line.findIndex((c) => c.trim()));
  const headers = line.slice(firstCol);
  const cells = planRow(headers, app);
  if (!cells.some(c => c.key === 'jobUrl')) throw new Error('Add a Job Posting URL column, then retry. It prevents duplicate rows after a connection interruption.');
  if (!cells.length) {
    throw new Error('None of the columns in your sheet look like company, position, date applied, link, location, work model, pay, or status.');
  }

  const below = await request(`/${sheetId}/values/${sheet}!A${headerAt + 2}:AZ?valueRenderOption=FORMULA`, { method: 'GET' });
  const rows: string[][] = below?.values ?? [];
  // A row is free when it has no company or position; stray content in other columns doesn't count.
  const identity = cells.filter((c) => c.key === 'company' || c.key === 'role' || c.key === 'jobUrl').map((c) => c.index);
  const urlColumn = cells.find(c => c.key === 'jobUrl');
  if (urlColumn) {
    const canonical = (url: string) => jobKey(postingUrl(url));
    const existing = rows.findIndex(r => canonical(String(r[firstCol + urlColumn.index] ?? '')) === canonical(app.url));
    if (existing >= 0) {
      // Already tracked: fill in details the row is missing (e.g. added by an earlier attempt), never overwrite.
      const row = rows[existing] ?? [];
      const missing = cells.filter((c) => !String(row[firstCol + c.index] ?? '').trim() && c.value);
      if (missing.length) await write(missing.map((c) => ({ range: `${columnLetter(firstCol + c.index)}${headerAt + 2 + existing}`, values: [[c.value]] })));
      return headerAt + 2 + existing;
    }
  }
  if (!identity.length && !urlColumn) throw new Error('Add a Company, Position or Job Posting URL header to identify applications.');
  const rowNumber = headerAt + 2 + firstEmptyRow(rows, identity.length ? identity : cells.map((c) => c.index), firstCol);

  await write(cells.filter(c => !String(rows[rowNumber - headerAt - 2]?.[firstCol + c.index] ?? '').trim()).map((c) => ({ range: `${columnLetter(firstCol + c.index)}${rowNumber}`, values: [[c.value]] })));
  return rowNumber;
}
