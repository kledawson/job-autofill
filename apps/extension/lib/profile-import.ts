import { emptyEducation, emptyExperience, emptyProfile, type Profile } from './types';

export const PROFILE_VERSION = 2;

/** Only changed fields are saved from an editor; an old tab must not erase newer imports. */
export function profileEdits(before: Profile, after: Profile): Record<string, unknown> {
  function changed(a: unknown, b: unknown): unknown {
    if (JSON.stringify(a) === JSON.stringify(b)) return undefined;
    if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(b)) {
        if (key === 'id' || key === 'updatedAt') continue;
        const edit = changed((a as Record<string, unknown>)[key], value);
        if (edit !== undefined) result[key] = edit;
      }
      return result;
    }
    return b;
  }
  return (changed(before, after) ?? {}) as Record<string, unknown>;
}

export function parseProfileFile(text: string): unknown {
  // Some Windows JSON exporters prepend a UTF-8 byte-order mark.
  return JSON.parse(text.replace(/^\uFEFF/, ''));
}
const ENUMS: Record<string, string[]> = {
  'workAuth.authorizedUS': ['', 'yes', 'no'],
  'workAuth.needsSponsorship': ['', 'yes', 'no'],
  'workAuth.usCitizen': ['', 'yes', 'no'],
  'workAuth.clearanceEligible': ['', 'yes', 'no'],
  'workAuth.authorizationScope': ['', 'any-employer', 'specific-employer'],
  'preferences.relocate': ['', 'yes', 'no'],
  'preferences.workMode': ['', 'remote', 'hybrid', 'onsite', 'flexible'],
};

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a profile object.');
  return value as Record<string, unknown>;
}

// Only known keys are copied. Missing keys preserve the base for patches, or
// acquire defaults for full imports and older stored profiles.
function merge(base: Record<string, unknown>, incoming: unknown, path = '', patch = false): Record<string, unknown> {
  const input = object(incoming);
  const out = { ...base };
  for (const key of Object.keys(base)) {
    if (!(key in input) || key === 'id' || key === 'updatedAt') continue;
    const value = input[key];
    const target = path ? `${path}.${key}` : key;
    const previous = base[key];
    if (Array.isArray(previous)) {
      if (!Array.isArray(value) || value.length > 1000) throw new Error(`Invalid ${target}.`);
      if (key === 'skills') {
        if (value.some(v => typeof v !== 'string' || v.length > 10000)) throw new Error('Invalid skills.');
        out[key] = value;
      } else {
        const template = key === 'education' ? emptyEducation() : emptyExperience();
        const entries = value.map((v, i) => merge(
          { ...template, ...(patch ? object(previous[i] ?? template) : {}) }, v, target, patch,
        ));
        out[key] = patch ? [...entries, ...previous.slice(entries.length)] : entries;
      }
    } else if (typeof previous === 'object' && previous) {
      out[key] = merge(object(previous), value, target, patch);
    } else {
      if (typeof value !== typeof previous || (typeof value === 'string' && value.length > 100000)) throw new Error(`Invalid ${target}.`);
      if (ENUMS[target] && !ENUMS[target].includes(value as string)) throw new Error(`Invalid ${target}.`);
      out[key] = value;
    }
  }
  return out;
}

export function normalizeProfile(value: unknown): Profile {
  const profile = merge({ ...emptyProfile() }, value) as unknown as Profile;
  const timestamp = object(value).updatedAt;
  profile.updatedAt = typeof timestamp === 'number' && Number.isFinite(timestamp) ? timestamp : 0;
  return profile;
}

export function importProfileData(value: unknown, current: Profile): Profile {
  const data = object(value);
  if (data.version !== undefined && data.version !== 1 && data.version !== PROFILE_VERSION) throw new Error('Unsupported profile version.');
  if (data.kind !== undefined && data.kind !== 'profile-patch') throw new Error('Unsupported import kind.');
  if (data.kind === 'profile-patch') {
    if (data.version !== PROFILE_VERSION) throw new Error('Profile updates require version 2.');
    const patch = object(data.profile);
    if (!Object.keys(patch).some(k => k in emptyProfile() && !['id', 'updatedAt'].includes(k))) throw new Error('Empty profile update.');
    return merge({ ...current }, patch, '', true) as unknown as Profile;
  }
  const incoming = object(data.profile ?? data);
  if (typeof incoming.firstName !== 'string') throw new Error('Not a profile export.');
  return normalizeProfile(incoming);
}
