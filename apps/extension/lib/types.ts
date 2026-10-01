export type YesNo = 'yes' | 'no' | '';

export interface Education {
  school: string;
  degree: string;
  major: string;
  gpa: string;
  /** YYYY-MM */
  startDate: string;
  /** YYYY-MM (expected, if still in school) */
  endDate: string;
  honors: string;
}

export interface Experience {
  title: string;
  company: string;
  location: string;
  /** YYYY-MM */
  startDate: string;
  /** YYYY-MM, empty when current */
  endDate: string;
  current: boolean;
  /** One bullet per line */
  bullets: string;
}

export interface Profile {
  id: 'me';
  firstName: string;
  lastName: string;
  preferredName: string;
  pronouns: string;
  /** Job title held now, e.g. "Software Engineering Intern". Empty if not working. */
  currentTitle: string;

  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  country: string;

  linkedin: string;
  github: string;
  portfolio: string;
  website: string;

  workAuth: {
    authorizedUS: YesNo;
    needsSponsorship: YesNo;
    status: string;
    authorizationScope: '' | 'any-employer' | 'specific-employer';
    usCitizen: YesNo;
    citizenshipCountry: string;
    exportStatus: string;
    activeClearance: string;
    clearanceEligible: YesNo;
  };

  education: Education[];
  experience: Experience[];
  skills: string[];

  preferences: {
    salary: string;
    startDate: string;
    relocate: YesNo;
    workMode: '' | 'remote' | 'hybrid' | 'onsite' | 'flexible';
    howHeard: string;
  };

  /** Voluntary self-identification. Never sent to Gemini. */
  eeo: {
    /** Use explicitly saved gender/Hispanic/race/veteran answers when enabled. */
    autofillSaved: boolean;
    gender: string;
    race: string;
    hispanic: string;
    veteran: string;
    disability: string;
  };

  updatedAt: number;
}

export const DECLINE = 'Decline to answer';

export function emptyEducation(): Education {
  return { school: '', degree: '', major: '', gpa: '', startDate: '', endDate: '', honors: '' };
}

export function emptyExperience(): Experience {
  return {
    title: '',
    company: '',
    location: '',
    startDate: '',
    endDate: '',
    current: false,
    bullets: '',
  };
}

export function emptyProfile(): Profile {
  return {
    id: 'me',
    firstName: '',
    lastName: '',
    preferredName: '',
    pronouns: '',
    currentTitle: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    state: '',
    zip: '',
    country: 'United States',
    linkedin: '',
    github: '',
    portfolio: '',
    website: '',
    workAuth: { authorizedUS: '', needsSponsorship: '', status: '', authorizationScope: '', usCitizen: '', citizenshipCountry: '', exportStatus: '', activeClearance: '', clearanceEligible: '' },
    education: [emptyEducation()],
    experience: [emptyExperience()],
    skills: [],
    preferences: { salary: '', startDate: '', relocate: '', workMode: '', howHeard: 'LinkedIn' },
    eeo: { autofillSaved: false, gender: DECLINE, race: DECLINE, hispanic: DECLINE, veteran: DECLINE, disability: DECLINE },
    updatedAt: 0,
  };
}

export interface StoredFile {
  kind: 'resume' | 'coverLetter';
  name: string;
  type: string;
  blob: Blob;
  updatedAt: number;
}

export type ApplicationStatus = 'Filling' | 'Ready for review' | 'Submitted' | 'Abandoned';

export type Platform = 'greenhouse' | 'lever' | 'ashby' | 'generic';

export interface FieldIssue {
  label: string;
  /** A non-sensitive explanation; never include applicant answers. */
  reason: string;
}

/** New message/record fields are optional; discard malformed or excessive diagnostics. */
export function readFieldIssues(value: unknown): FieldIssue[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 500).flatMap(issue => {
    if (!issue || typeof issue.label !== 'string' || typeof issue.reason !== 'string') return [];
    if (issue.label.length > 90 || issue.reason.length > 600) return [];
    return [{ label: issue.label, reason: issue.reason }];
  });
}

export interface Application {
  id?: number;
  url: string;
  /** Normalized job identity, see jobKey() */
  jobKey: string;
  company: string;
  role: string;
  platform: Platform;
  status: ApplicationStatus;
  tabId?: number;
  filledAt: number;
  submittedAt?: number;
  aiAnswers: number;
  filledCount: number;
  missingCount: number;
  missingLabels: string[];
  /** Optional so previously stored application records remain readable. */
  missingFields?: FieldIssue[];
  sheetRow?: number;
  sheetError?: string;
}

export interface SavedAnswer {
  id?: number;
  key: string;
  question: string;
  answer: string;
  source: 'user' | 'ai';
  lastUsed: number;
}

export interface FieldMapping {
  id?: number;
  label: string;
  platform: string;
  profileKey: string;
  confidence: number;
  source: 'rule' | 'ai';
}

export interface Settings {
  geminiApiKey: string;
  geminiModel: string;
  promptTemplate: string;
  sheetId: string;
  sheetUrl: string;
  onboardingComplete: boolean;
}
