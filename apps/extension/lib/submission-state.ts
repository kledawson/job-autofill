import type { Application } from './types';

/** Used in the same transaction as either standalone or queue completion. */
export function submittedPatch(app: Application, source: NonNullable<Application['submissionSource']>, now = Date.now()): Partial<Application> {
  if (app.status === 'Submitted') return {};
  return { status: 'Submitted', submittedAt: now, submissionSource: source, submitIntentAt: undefined, submissionIssue: undefined,
    sheetSyncPending: true, sheetError: undefined };
}
