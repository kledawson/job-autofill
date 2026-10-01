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
  age: string;
  /** Dialing code with a leading +, e.g. "+1". */
  countryCode: string;
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
  };

  education: Education[];
  experience: Experience[];
  skills: string[];

  preferences: {
    salary: string;
    startDate: string;
    relocate: YesNo;
    workMode: '' | 'remote' | 'hybrid' | 'onsite' | 'flexible';
  };

  /** Voluntary self-identification. Never sent to Gemini. */
  eeo: {
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
    age: '',
    countryCode: '+1',
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
    workAuth: { authorizedUS: '', needsSponsorship: '', status: '' },
    education: [emptyEducation()],
    experience: [emptyExperience()],
    skills: [],
    preferences: { salary: '', startDate: '', relocate: '', workMode: '' },
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

export type Platform = 'greenhouse' | 'lever' | 'ashby';

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
