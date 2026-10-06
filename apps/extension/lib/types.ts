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
  /** Employer now. Empty if not working; autofill answers "N/A" only when the field is required. */
  currentCompany: string;
  /** Most recent past employer, for "previous employer" questions. */
  previousCompany: string;
  /** Job title at the previous employer. */
  previousTitle: string;

  email: string;
  age: string;
  /** Dialing code with a leading +, e.g. "+1". */
  countryCode: string;
  phone: string;
  /** Agrees to receive text message updates about applications; answers "Yes"/"No" to SMS consent questions. */
  textConsent: boolean;
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
    /** Highest active security clearance, one of CLEARANCE_LEVELS (empty when not set). */
    clearance: string;
    /** Current or former employee of the U.S. government. */
    govEmployee: YesNo;
    /** Citizen of any country besides the one in `country`/status. */
    otherCitizenship: YesNo;
    /** Those other countries, comma-separated (for export-control questions). */
    otherCountries: string;
  };

  education: Education[];
  experience: Experience[];
  skills: string[];

  preferences: {
    salary: string;
    startDate: string;
    relocate: YesNo;
    workMode: '' | 'remote' | 'hybrid' | 'onsite' | 'flexible';
    /** Bound by a non-compete, non-solicitation, or similar agreement with a current or past employer. */
    nonCompete: YesNo;
  };

  /** Voluntary self-identification. Never sent to Gemini. */
  eeo: {
    gender: string;
    /** One race, several joined with "; " (see racesOf), or DECLINE. */
    race: string;
    hispanic: string;
    veteran: string;
    disability: string;
  };

  updatedAt: number;
}

export const DECLINE = 'Decline to answer';

/** Saved races, or [] when declined. Several are stored joined with "; ". */
export function racesOf(race: string): string[] {
  return race
    .split(';')
    .map((r) => r.trim())
    .filter((r) => r && r !== DECLINE);
}

export const WORK_STATUSES = ['US Citizen', 'Permanent Resident (Green Card)', 'Asylee / Refugee', 'F-1 (OPT/CPT)', 'H-1B', 'Other visa'];

export const CLEARANCE_LEVELS = [
  'None / never held',
  'Secret',
  'Top Secret',
  'Top Secret SCI',
  'Top Secret SCI with Polygraph',
  'DOE Q',
  'Expired',
  'Prefer not to disclose',
];

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
    currentCompany: '',
    previousCompany: '',
    previousTitle: '',
    email: '',
    age: '',
    countryCode: '+1',
    phone: '',
    textConsent: false,
    address: '',
    city: '',
    state: '',
    zip: '',
    country: 'United States',
    linkedin: '',
    github: '',
    portfolio: '',
    website: '',
    workAuth: { authorizedUS: '', needsSponsorship: '', status: '', clearance: '', govEmployee: '', otherCitizenship: '', otherCountries: '' },
    education: [emptyEducation()],
    experience: [emptyExperience()],
    skills: [],
    preferences: { salary: '', startDate: '', relocate: '', workMode: '', nonCompete: '' },
    eeo: { gender: DECLINE, race: DECLINE, hispanic: DECLINE, veteran: DECLINE, disability: DECLINE },
    updatedAt: 0,
  };
}

export interface StoredFile {
  kind: 'resume' | 'coverLetter' | 'transcript';
  name: string;
  type: string;
  blob: Blob;
  updatedAt: number;
}

export type ApplicationStatus = 'Filling' | 'Ready for review' | 'Submitted' | 'Abandoned';

/** Known applicant tracking systems; `other` is any company careers site or unrecognized form. */
export type Platform = 'greenhouse' | 'lever' | 'ashby' | 'workday' | 'other';

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
  /** Full question aligned with missingLabels; null means a manual-only field. No answers stored here. */
  missingQuestions?: (string | null)[];
  /** Selected-field identities, never applicant answers. Stale tokens are rejected after navigation. */
  reviewFields?: import('./remembered-mappings').ReviewField[];
  /** Current eligible questions, including completed fields; never contains page answers. */
  memoryQuestions?: string[];
  /** "City, State" read from the posting; blank when the page doesn't say. */
  location?: string;
  workMode?: 'Remote' | 'Hybrid' | 'On-site';
  /** Posted pay range as text, blank when the posting has none. */
  basePay?: string;
  frameId?: number;
  topUrl?: string;
  /** Set once the submitted application's row is in the sheet; prevents duplicate rows. */
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
