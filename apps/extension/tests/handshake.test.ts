// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { ADAPTERS } from '../lib/autofill/adapters';

describe('Handshake job pages', () => {
  it('reads role and company from the title and the job details container', () => {
    (window as any).happyDOM.setURL('https://app.joinhandshake.com/jobs/11601232?searchId=abc');
    document.title = 'Applied AI Software Engineer (New Grad) | Lyra | Handshake';
    document.body.innerHTML = `<h1>Share this job</h1><div data-hook="job-details-page"><div>Lyra</div><div>Aerospace</div>
      <h1>Applied AI Software Engineer (New Grad)</h1><span>Hawthorne, CA</span><p>Pay: $120,000 - $150,000 per year</p></div>`;
    const info = ADAPTERS.other.jobInfo(document);
    expect(info.company).toBe('Lyra');
    expect(info.role).toBe('Applied AI Software Engineer (New Grad)');
    expect(info.location).toBe('Hawthorne, CA');
  });
});
