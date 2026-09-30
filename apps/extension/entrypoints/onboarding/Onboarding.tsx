import { useState, type ReactNode } from 'react';
import { browser } from 'wxt/browser';
import { usePublicSettings, useProfile } from '@/components/hooks';
import {
  BasicsSection,
  EducationSection,
  EeoSection,
  ExperienceSection,
  LinksSection,
  missingRequired,
  PreferencesSection,
  WorkAuthSection,
} from '@/components/ProfileSections';
import { DocumentsSection, GeminiSection, PromptSection, SheetsSection } from '@/components/SettingsSections';
import { Button, Card, Notice } from '@/components/ui';
import { updateSettings } from '@/lib/settings';

const STEPS = ['Welcome', 'Resume', 'About you', 'Education', 'Experience', 'Common questions', 'Connect', 'Prompt', 'Done'] as const;

export default function Onboarding() {
  const [step, setStep] = useState(0);
  const { profile, update, save } = useProfile();
  const { settings } = usePublicSettings();
  const [warning, setWarning] = useState('');

  if (!profile) return null;
  const sectionProps = {
    profile,
    onChange: (next: typeof profile) => {
      setWarning('');
      update(next);
    },
  };

  async function next() {
    setWarning('');
    if (STEPS[step] === 'About you') {
      const missing = missingRequired(profile!).filter((m) => !['work authorization', 'sponsorship'].includes(m));
      if (missing.length) return setWarning(`Please add your ${missing.join(', ')}.`);
    }
    if (STEPS[step] === 'Common questions' && (!profile!.workAuth.authorizedUS || !profile!.workAuth.needsSponsorship)) {
      return setWarning('Please answer both work authorization questions. Nearly every application asks them.');
    }
    await save();
    if (step === STEPS.length - 2) await updateSettings({ onboardingComplete: true });
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
    window.scrollTo({ top: 0 });
  }

  let body: ReactNode;
  switch (STEPS[step]) {
    case 'Welcome':
      body = (
        <Card>
          <div className="space-y-4 text-slate-700">
            <h1 className="text-2xl font-semibold text-slate-900">Apply faster, stay in control.</h1>
            <p>
              Job Autofill fills Greenhouse, Lever, and Ashby applications from a profile you enter once, writes
              free-response answers with Gemini, and stops so you can review everything.
            </p>
            <ul className="space-y-2 text-sm">
              <li className="flex gap-2">
                <Dot color="bg-green-600" /> <span><b>It never submits.</b> You always click Submit yourself.</span>
              </li>
              <li className="flex gap-2">
                <Dot color="bg-indigo-600" /> <span><b>Your data stays on this computer.</b> There is no server. Only questions and job details go to Gemini, and application rows to your own Google Sheet.</span>
              </li>
              <li className="flex gap-2">
                <Dot color="bg-amber-500" /> <span><b>Setup takes about 10 minutes.</b> You can change anything later in settings.</span>
              </li>
            </ul>
          </div>
        </Card>
      );
      break;
    case 'Resume':
      body = <DocumentsSection />;
      break;
    case 'About you':
      body = (
        <div className="space-y-4">
          <BasicsSection {...sectionProps} />
          <LinksSection {...sectionProps} />
        </div>
      );
      break;
    case 'Education':
      body = <EducationSection {...sectionProps} />;
      break;
    case 'Experience':
      body = <ExperienceSection {...sectionProps} />;
      break;
    case 'Common questions':
      body = (
        <div className="space-y-4">
          <WorkAuthSection {...sectionProps} />
          <PreferencesSection {...sectionProps} />
          <EeoSection {...sectionProps} />
        </div>
      );
      break;
    case 'Connect':
      body = (
        <div className="space-y-4">
          {settings && <GeminiSection settings={settings} />}
          {settings && <SheetsSection settings={settings} />}
          <p className="text-sm text-slate-500">Both are optional. Without Gemini, free-response questions are outlined for you to answer.</p>
        </div>
      );
      break;
    case 'Prompt':
      body = settings && <PromptSection settings={settings} />;
      break;
    case 'Done':
      body = (
        <Card>
          <div className="space-y-4 text-slate-700">
            <h1 className="text-2xl font-semibold text-slate-900">You’re set up.</h1>
            <ol className="list-decimal space-y-1.5 pl-5 text-sm">
              <li>Click the Job Autofill icon in the toolbar to open the side panel. Pin it for quick access.</li>
              <li>Paste a Greenhouse, Lever, or Ashby job link and click <b>Open and fill</b>.</li>
              <li>Check the outlined fields: <span className="font-medium text-green-700">green</span> came from your profile, <span className="font-medium text-blue-700">blue</span> was written by AI, <span className="font-medium text-red-700">red</span> needs you.</li>
              <li>Submit the application yourself, then click <b>Mark as submitted</b> in the side panel.</li>
            </ol>
            <div className="flex gap-2 pt-2">
              <Button
                onClick={async () => {
                  const win = await browser.windows.getCurrent();
                  if (win.id !== undefined) await browser.sidePanel.open({ windowId: win.id });
                }}
              >
                Open side panel
              </Button>
              <Button variant="secondary" onClick={() => browser.runtime.openOptionsPage()}>
                Settings
              </Button>
            </div>
          </div>
        </Card>
      );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <header className="mb-6 flex items-center gap-3">
        <img src="/icon/48.png" alt="" className="size-9" />
        <div>
          <p className="text-sm font-semibold text-slate-900">Job Autofill setup</p>
          <p className="text-xs text-slate-500">
            Step {step + 1} of {STEPS.length}: {STEPS[step]}
          </p>
        </div>
      </header>
      <div className="mb-6 flex gap-1" aria-hidden>
        {STEPS.map((s, i) => (
          <div key={s} className={`h-1.5 flex-1 rounded-full ${i <= step ? 'bg-indigo-600' : 'bg-slate-200'}`} />
        ))}
      </div>

      {body}

      {warning && (
        <div className="mt-4">
          <Notice tone="warn">{warning}</Notice>
        </div>
      )}

      {STEPS[step] !== 'Done' && (
        <div className="mt-6 flex justify-between">
          <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
            Back
          </Button>
          <Button onClick={next}>{step === 0 ? 'Get started' : 'Continue'}</Button>
        </div>
      )}
    </div>
  );
}

function Dot({ color }: { color: string }) {
  return <span className={`mt-1.5 size-2 shrink-0 rounded-full ${color}`} />;
}
