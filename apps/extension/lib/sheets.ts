// Background worker only. Uses chrome.identity with the drive.file scope, so the
// extension can only see the spreadsheet it creates.
import { browser } from 'wxt/browser';
import type { Application } from './types';
import { PLATFORM_NAMES } from './platforms';

const API = 'https://sheets.googleapis.com/v4/spreadsheets';
const TAB = 'Applications';
export const COLUMNS = [
  'Date filled',
  'Company',
  'Role',
  'Job link',
  'Platform',
  'Status',
  'Date submitted',
  'AI answers used',
  'Notes',
];

export function sheetsConfigured(): boolean {
  return !!(browser.runtime.getManifest() as { oauth2?: { client_id?: string } }).oauth2?.client_id;
}

async function getToken(interactive: boolean): Promise<string> {
  const res = await browser.identity.getAuthToken({ interactive });
  const token = typeof res === 'string' ? res : res?.token;
  if (!token) throw new Error('Not signed in to Google.');
  return token;
}

async function request(path: string, init: RequestInit, interactive = false): Promise<any> {
  let token = await getToken(interactive);
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${API}${path}`, {
      ...init,
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

export async function createTrackingSheet(): Promise<{ id: string; url: string }> {
  const body = await request(
    '',
    {
      method: 'POST',
      body: JSON.stringify({
        properties: { title: 'Job Applications' },
        sheets: [
          {
            properties: { title: TAB, gridProperties: { frozenRowCount: 1 } },
            data: [
              {
                startRow: 0,
                startColumn: 0,
                rowData: [
                  {
                    values: COLUMNS.map((c) => ({
                      userEnteredValue: { stringValue: c },
                      userEnteredFormat: { textFormat: { bold: true } },
                    })),
                  },
                ],
              },
            ],
          },
        ],
      }),
    },
    true,
  );
  return { id: body.spreadsheetId, url: body.spreadsheetUrl };
}

/** Prevent page text like "=IMPORTXML(...)" from being evaluated as a formula. */
function safe(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function date(ms?: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function row(app: Application): string[] {
  return [
    date(app.filledAt),
    safe(app.company),
    safe(app.role),
    app.url,
    PLATFORM_NAMES[app.platform],
    app.status,
    date(app.submittedAt),
    String(app.aiAnswers),
  ];
}

/** Appends the application and returns its 1-based row number. */
export async function appendApplication(sheetId: string, app: Application): Promise<number> {
  const body = await request(
    `/${sheetId}/values/${encodeURIComponent(`${TAB}!A:H`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { method: 'POST', body: JSON.stringify({ values: [row(app)] }) },
  );
  const range: string = body?.updates?.updatedRange ?? '';
  const rowNumber = /![A-Z]+(\d+)/.exec(range)?.[1];
  if (!rowNumber) throw new Error('Google Sheets did not report the new row.');
  return parseInt(rowNumber, 10);
}

/** Rewrites status, submitted date, and AI count; leaves the Notes column alone. */
export async function updateApplication(sheetId: string, app: Application): Promise<void> {
  const r = app.sheetRow!;
  await request(`/${sheetId}/values/${encodeURIComponent(`${TAB}!A${r}:H${r}`)}?valueInputOption=USER_ENTERED`, {
    method: 'PUT',
    body: JSON.stringify({ values: [row(app)] }),
  });
}
