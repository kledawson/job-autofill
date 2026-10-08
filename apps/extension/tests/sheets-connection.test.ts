import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const identity = vi.hoisted(() => ({ getAuthToken: vi.fn(), removeCachedAuthToken: vi.fn() }));
vi.mock('wxt/browser', () => ({ browser: { identity, runtime: { getManifest: () => ({ oauth2: { client_id: 'fictional-client' } }) } } }));
import { appendApplication, openSheet, sheetTabId, testSheetConnection } from '../lib/sheets';
import type { Application } from '../lib/types';
const metadata = { spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/fictional/edit', sheets: [{ properties: { sheetId: 0, title: 'First tab' } }, { properties: { sheetId: 42, title: "Jobs' tracker" } }] };
const app = { url: 'https://jobs.example/apply/123', company: 'Fictional Company', role: 'Engineer', status: 'Submitted', platform: 'other', jobKey: '123', filledAt: 1, submittedAt: 1, aiAnswers: 0, filledCount: 0, missingCount: 0, missingLabels: [] } as Application;
let fetchMock: ReturnType<typeof vi.fn>;
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
beforeEach(() => { identity.getAuthToken.mockReset().mockResolvedValue({ token: 'fictional-token' }); identity.removeCachedAuthToken.mockReset(); fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => vi.unstubAllGlobals());
describe('sheet tab targeting and request flow', () => {
  it('parses query and fragment tab IDs including zero and rejects invalid explicit IDs', () => {
    expect(sheetTabId('https://docs.google.com/spreadsheets/d/x/edit?gid=42#gid=9')).toBe(42);
    expect(sheetTabId('https://docs.google.com/spreadsheets/d/x/edit#gid=0')).toBe(0);
    expect(sheetTabId('https://docs.google.com/spreadsheets/d/x/edit')).toBeUndefined();
    expect(() => sheetTabId('https://docs.google.com/spreadsheets/d/x/edit#gid=bad')).toThrow('invalid');
  });
  it('selects the requested tab and uses the first only for legacy/no-tab connections', async () => {
    fetchMock.mockImplementation(async () => reply(metadata));
    expect(await openSheet('fictional', true, 42)).toMatchObject({ tab: "Jobs' tracker", tabId: 42, url: expect.stringContaining('#gid=42') });
    expect(await openSheet('fictional')).toMatchObject({ tab: 'First tab', tabId: 0 });
    await expect(openSheet('fictional', false, 99)).rejects.toThrow('no longer exists');
  });
  it('tests selected headers without sending a write request', async () => {
    fetchMock.mockResolvedValueOnce(reply(metadata)).mockResolvedValueOnce(reply({ values: [['Company', 'Position', 'Referral', 'Posting URL']] }));
    expect(await testSheetConnection('fictional', 42)).toMatchObject({ tabId: 42, columns: ['company', 'role', 'jobUrl'] });
    expect(fetchMock.mock.calls.every(call => call[1].method === 'GET')).toBe(true);
    expect(decodeURIComponent(fetchMock.mock.calls[1]![0])).toContain("'Jobs'' tracker'!A1:AZ10");
  });
  it('writes only empty recognized cells and preserves formulas/defaults and unrelated columns', async () => {
    fetchMock.mockResolvedValueOnce(reply(metadata)).mockResolvedValueOnce(reply({ values: [['Company', 'Position', 'Status', 'Referral', 'Posting URL']] })).mockResolvedValueOnce(reply({ values: [['', '', '=IF(A2="","", "Applied")', 'Keep this']] })).mockResolvedValueOnce(reply({}));
    expect(await appendApplication('fictional', app, 42)).toBe(2);
    const data = JSON.parse(fetchMock.mock.calls[3]![1].body).data;
    expect(data.map((d: any) => d.range)).toEqual(["'Jobs'' tracker'!A2", "'Jobs'' tracker'!B2", "'Jobs'' tracker'!E2"]);
  });
  it('a retry finds an existing posting URL instead of writing another row', async () => {
    fetchMock.mockResolvedValueOnce(reply(metadata)).mockResolvedValueOnce(reply({ values: [['Company', 'Position', 'Posting URL']] })).mockResolvedValueOnce(reply({ values: [[app.company, app.role, app.url + '#view']] }));
    expect(await appendApplication('fictional', app, 42)).toBe(2); expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it('refreshes an expired OAuth token once and reports permission failures', async () => {
    fetchMock.mockResolvedValueOnce(reply({}, 401)).mockResolvedValueOnce(reply(metadata));
    await openSheet('fictional', false, 42); expect(identity.removeCachedAuthToken).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValueOnce(reply({ error: { message: 'Permission denied' } }, 403));
    await expect(openSheet('fictional')).rejects.toThrow('Permission denied');
  });
});
