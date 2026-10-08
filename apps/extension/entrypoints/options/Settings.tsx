import { useEffect, useState } from 'react';
import { usePublicSettings, useProfile } from '@/components/hooks';
import {
  BasicsSection,
  EducationSection,
  EeoSection,
  ExperienceSection,
  LinksSection,
  missingRequired,
  PreferencesSection,
  SkillsSection,
  WorkAuthSection,
} from '@/components/ProfileSections';
import { DataSection, DocumentsSection, GeminiSection, PromptSection, SheetsSection } from '@/components/SettingsSections';
import { Button, SELECT_ARROW, cx } from '@/components/ui';
import { mergeResumeDraft } from '@/lib/resume';
import { KnowledgeSection } from '@/components/KnowledgeBase';

const NAV = [
  ['profile', 'Profile'],
  ['memories', 'Memories'],
  ['documents', 'Documents'],
  ['connections', 'Connections'],
  ['prompt', 'Prompt'],
  ['data', 'Data'],
] as const;
type Tab = (typeof NAV)[number][0];
const tabFromHash = (): Tab => {
  const value = location.hash.slice(1);
  if (value === 'knowledge') return 'memories'; // Existing bookmarks remain usable.
  return NAV.find(([id]) => id === value)?.[0] ?? 'profile';
};

export default function Settings() {
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const { profile, update, save, replace, dirty, savedAt, reload, saveError } = useProfile();
  const { settings } = usePublicSettings();
  const [version, setVersion] = useState(0);

  useEffect(() => {
    history.replaceState(null, '', `#${tab}`);
  }, [tab]);
  useEffect(() => {
    const change = () => setTab(tabFromHash());
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  function chooseTab(next: Tab) { setTab(next); window.scrollTo({ top: 0, behavior: 'instant' }); }

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  if (!profile) return null;
  const sectionProps = { profile, onChange: update };
  const gaps = missingRequired(profile);

  return (
    <div className="mx-auto flex max-w-5xl gap-8 px-4 py-8">
      <nav className="sticky top-8 hidden h-fit w-44 shrink-0 sm:block">
        <div className="mb-5 flex items-center gap-2">
          <img src="/icon/48.png" alt="" className="size-7" />
          <span className="text-sm font-semibold">Job Autofill</span>
        </div>
        <ul className="space-y-0.5">
          {NAV.map(([id, label]) => (
            <li key={id}>
              <button
                className={cx(
                  'w-full rounded-lg px-3 py-2 text-left text-sm',
                  tab === id ? 'bg-indigo-50 font-medium text-indigo-800' : 'text-slate-600 hover:bg-slate-100',
                )}
                aria-current={tab === id ? 'page' : undefined}
                onClick={() => chooseTab(id)}
              >
                {label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <main className="min-w-0 flex-1 space-y-4 pb-24">
        <select
          aria-label="Settings section"
          className={`mb-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 pr-10 text-sm sm:hidden ${SELECT_ARROW}`}
          value={tab}
          onChange={(e) => chooseTab(e.target.value as Tab)}
        >
          {NAV.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>

        {tab === 'profile' && (
          <div key={version} className="space-y-4">
            <BasicsSection {...sectionProps} />
            <LinksSection {...sectionProps} />
            <WorkAuthSection {...sectionProps} />
            <EducationSection {...sectionProps} />
            <ExperienceSection {...sectionProps} />
            <SkillsSection {...sectionProps} />
            <PreferencesSection {...sectionProps} />
            <EeoSection {...sectionProps} />
          </div>
        )}
        {tab === 'documents' && (
          <DocumentsSection
            hasGeminiKey={settings?.hasGeminiKey}
            onNeedKey={() => setTab('connections')}
            onResumeDraft={async (draft) => {
              const merged = mergeResumeDraft(profile, draft);
              await replace(merged.profile);
              setVersion((v) => v + 1);
              return merged.filled;
            }}
          />
        )}
        {tab === 'connections' && settings && (
          <>
            <GeminiSection settings={settings} />
            <SheetsSection settings={settings} />
          </>
        )}
        {tab === 'prompt' && settings && <PromptSection settings={settings} />}
        {tab === 'memories' && <KnowledgeSection />}
        {tab === 'data' && (
          <DataSection
            onImported={async () => {
              await reload();
              setVersion((v) => v + 1);
            }}
          />
        )}
      </main>

      {tab === 'profile' && (
        <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center justify-end gap-3 px-4 py-3">
            {gaps.length > 0 ? (
              <span className="text-sm text-red-700">Fill out required fields to save: {gaps.join(', ')}</span>
            ) : (
              <span className="text-sm text-slate-500">
                {dirty ? 'Unsaved changes' : savedAt ? 'Saved' : 'All changes saved'}
              </span>
            )}
            {saveError && <p role="alert" className="text-sm text-red-700">{saveError} <button className="underline" onClick={() => void reload()}>Reload saved profile</button></p>}
            <Button onClick={save} disabled={!dirty || gaps.length > 0}>
              Save profile
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
