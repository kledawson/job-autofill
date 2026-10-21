import { browser } from 'wxt/browser';

/** Public build metadata only; never includes Profile, Memories, URLs or integration settings. */
export function BuildInfo() {
  return <footer className="mt-auto pt-2 text-xs text-slate-500">
    <details className="rounded-lg border border-slate-200 bg-white p-2">
      <summary className="cursor-pointer rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500">Version {browser.runtime.getManifest().version} · Extension info</summary>
      <p className="mt-2 break-all">Build: <time dateTime={__BUILD__}>{__BUILD__}</time></p>
      <p className="mt-1">After rebuilding, reload the extension in chrome://extensions and refresh open application tabs. Copy unsaved answers before refreshing.</p>
    </details>
  </footer>;
}
