import { afterEach, describe, expect, it } from 'vitest';
import { hasSubmissionErrors, isSubmissionUrl, readSubmissionEvidence, recentSubmitIntent } from '../lib/submission-confirmation';
import { submittedPatch } from '../lib/submission-state';
import type { Application } from '../lib/types';

afterEach(() => { document.body.innerHTML = ''; });
const hosts = ['job-boards.greenhouse.io/example/jobs/123', 'jobs.lever.co/example/123/apply', 'jobs.ashbyhq.com/example/123/application'];
describe('shared submission evidence', () => {
  it('requires a supported visible confirmation with no surviving application controls or error', () => {
    for (const [index, path] of hosts.entries()) {
      (window as any).happyDOM.setURL('https://' + path);
      document.body.innerHTML = '<h1>Application submitted successfully.</h1>';
      expect(readSubmissionEvidence(document)).toBe(['greenhouse-confirmation', 'lever-confirmation', 'ashby-confirmation'][index]);
      for (const extra of ['<form><input></form>', '<form><textarea></textarea></form>', '<p role="alert">Unable to submit</p>', '<div aria-invalid="true"></div>']) {
        document.body.innerHTML = '<h1>Application submitted successfully.</h1>' + extra;
        expect(readSubmissionEvidence(document)).toBeNull();
      }
      for (const markup of ['<h1 hidden>Application submitted successfully.</h1>', '<div class="job-description"><h2>Thanks for applying!</h2></div>', '<h1>Thank you</h1>', '<h1>Application could not be submitted.</h1>']) {
        document.body.innerHTML = markup; expect(readSubmissionEvidence(document)).toBeNull();
      }
    }
  });
  it('does not authorize cross-job, cross-company or cross-origin redirects', () => {
    for (const path of hosts) {
      const url = 'https://' + path;
      expect(isSubmissionUrl(url, url)).toBe(true);
      for (const target of [url.replace('123', '456'), url.replace('/example/', '/different/'), url.replace('https:', 'http:'), 'https://evil.example/thanks']) expect(isSubmissionUrl(url, target)).toBe(false);
    }
    expect(isSubmissionUrl('https://jobs.lever.co/example/123/apply', 'https://jobs.lever.co/example/123/thanks')).toBe(true);
    expect(isSubmissionUrl('https://jobs.ashbyhq.com/example/123/application', 'https://jobs.ashbyhq.com/example/123/confirmation')).toBe(true);
    expect(isSubmissionUrl('https://jobs.lever.co/example/123/apply', 'https://jobs.lever.co/example/thanks')).toBe(false);
    expect(isSubmissionUrl('https://example.com/123', 'https://example.com/123')).toBe(false);
  });
  it('expires old/future/malformed intent and flags validation only on visible controls', () => {
    for (const at of [undefined, NaN, Infinity, '100', 101, -600001]) expect(recentSubmitIntent(at, 100)).toBe(false);
    expect(recentSubmitIntent(100, 100)).toBe(true);
    document.body.innerHTML = '<form><input required><p role="alert" hidden>Invalid</p></form>';
    expect(hasSubmissionErrors(document)).toBe(true);
    document.body.innerHTML = '<form><input><p role="alert" hidden>Invalid</p></form>';
    expect(hasSubmissionErrors(document)).toBe(false);
    document.body.innerHTML = '<form><input aria-invalid="false"></form>';
    expect(hasSubmissionErrors(document)).toBe(false);
  });
  it('records the confirmation source once without changing the date or reenqueuing Sheets', () => {
    const app = { status: 'Ready for review' } as Application;
    const patch = submittedPatch(app, 'lever-confirmation', 123);
    expect(patch).toMatchObject({ status: 'Submitted', submissionSource: 'lever-confirmation', submittedAt: 123, sheetSyncPending: true });
    expect(submittedPatch({ ...app, ...patch }, 'user', 456)).toEqual({});
  });
});
