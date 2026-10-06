import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';
import { ALL_SITES, ATS_MATCHES } from './lib/platforms';

// Public key that pins the unpacked extension ID to kjepjmmbimmbpdfinkippakkmhbglccc,
// so a Google OAuth client created for that ID keeps working across reloads.
// Remove it before uploading to the Chrome Web Store (the store assigns its own key).
const EXTENSION_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA4ULs90+KZc+yY/5E8mcP/jIo8fil7rKNr83qz4/mG8/JVfmoh/WU4W4T5LXAYzAzUjpkCvPzwPNEzfLflwSbWdGsptUQw1CO6RnfMx1ZcmKQbiwMDwJIvLgtxRYG2yvKmr2CaZLFXSJW4zmLzf7rdOfTAWRLXCT+aonlie0VFmOlU7O5T6xZZ5PaMiMdm0eXbRLN8zc0TELl3nMJoLZrCOcAatNZB1KCy3t4i9E22785U1E4iSH2VJ76qbOqyAKDF1ySPg4mjcsAZfc2yN/pwaNeT3uKBcdL+n7imMprN+Tbwgj1MENSQKTZYQ5y5sDcywZdrBp1NsHdy8DAyOPJeQIDAQAB';

// Google OAuth client ID (type "Chrome Extension") for Sheets sync. See README.
const GOOGLE_CLIENT_ID = process.env.WXT_GOOGLE_CLIENT_ID ?? '';

export default defineConfig({
  // Visible folder (not the default .output) so it is easy to pick in Chrome's Load unpacked dialog.
  outDir: 'dist',
  modules: ['@wxt-dev/module-react'],
  vite: () => ({ plugins: [tailwindcss()], define: { __BUILD__: JSON.stringify(new Date().toISOString()) } }),
  manifest: {
    name: 'Job Application Autofill',
    description:
      'Fills job applications (Greenhouse, Lever, Ashby, Workday, and company career sites) from your saved profile and stops for your review. Never submits for you.',
    key: EXTENSION_KEY,
    permissions: [
      'storage',
      'unlimitedStorage',
      'sidePanel',
      'notifications',
      'identity',
      'activeTab',
      'scripting',
    ],
    host_permissions: [
      ...ATS_MATCHES,
      'https://api.ashbyhq.com/*',
      'https://api.lever.co/*',
      'https://generativelanguage.googleapis.com/*',
      'https://sheets.googleapis.com/*',
    ],
    // Asked for at runtime, only when the person fills a page outside the job sites above.
    optional_host_permissions: ALL_SITES,
    action: { default_title: 'Job Application Autofill' },
    ...(GOOGLE_CLIENT_ID
      ? {
          oauth2: {
            client_id: GOOGLE_CLIENT_ID,
            scopes: ['https://www.googleapis.com/auth/drive.file'],
          },
        }
      : {}),
  },
});
