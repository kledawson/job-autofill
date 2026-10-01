import { describe, expect, it } from 'vitest';
import { importProfileData, normalizeProfile, parseProfileFile, profileEdits } from '../lib/profile-import';
import { emptyProfile } from '../lib/types';

describe('profile compatibility and updates', () => {
  it('reads Windows JSON files with a byte-order mark', () => {
    expect(parseProfileFile('\uFEFF{"version":2,"kind":"profile-patch","profile":{"workAuth":{"usCitizen":"yes"}}}'))
      .toMatchObject({ profile: { workAuth: { usCitizen: 'yes' } } });
  });
  it('saves only edited fields from stale editor snapshots', () => {
    const baseline = emptyProfile();
    const edited = structuredClone(baseline);
    edited.city = 'Example City';
    const latest = importProfileData({ version: 2, kind: 'profile-patch', profile: {
      workAuth: { usCitizen: 'yes', authorizationScope: 'any-employer', clearanceEligible: 'no' },
    } }, baseline);
    const edits = profileEdits(baseline, edited);
    expect(edits).toEqual({ city: 'Example City' });
    const merged = importProfileData({ version: 2, kind: 'profile-patch', profile: edits }, latest);
    expect(merged.workAuth.usCitizen).toBe('yes');
    expect(merged.workAuth.clearanceEligible).toBe('no');
    expect(merged.city).toBe('Example City');
  });
  it('migrates version 1 exports without inferring eligibility', () => {
    const p = importProfileData({ version: 1, profile: { firstName: 'Example', workAuth: { authorizedUS: 'yes', status: 'US Citizen' } } }, emptyProfile());
    expect(p.workAuth.usCitizen).toBe('');
    expect(p.workAuth.clearanceEligible).toBe('');
    expect(p.workAuth.authorizedUS).toBe('yes');
    expect(normalizeProfile({ ...p, updatedAt: 123 }).updatedAt).toBe(123);
  });
  it('merges a patch without erasing contact details, education, or saved answers', () => {
    const p = emptyProfile();
    p.email = 'example@example.test';
    p.education[0]!.school = 'Example University';
    p.workAuth.needsSponsorship = 'no';
    const next = importProfileData({ version: 2, kind: 'profile-patch', profile: {
      education: [{ gpa: '3.8' }], workAuth: { usCitizen: 'yes', activeClearance: 'Never held a clearance' },
    } }, p);
    expect(next.email).toBe(p.email);
    expect(next.education[0]).toMatchObject({ school: 'Example University', gpa: '3.8' });
    expect(next.workAuth.needsSponsorship).toBe('no');
    expect(p.education[0]!.gpa).toBe('');
  });
  it('rejects malformed imports and unsupported versions before changing anything', () => {
    const p = emptyProfile();
    for (const data of [null, { version: 3, profile: p }, { firstName: 8 },
      { version: 2, kind: 'profile-patch', profile: { workAuth: { usCitizen: 'maybe' } } },
      { version: 2, kind: 'profile-patch', profile: { eeo: { autofillSaved: 'true' } } },
      { firstName: 'Example', education: [null] }, { firstName: 'Example', skills: [42] }]) {
      expect(() => importProfileData(data, p)).toThrow();
    }
    expect(p).toEqual(emptyProfile());
  });
});
