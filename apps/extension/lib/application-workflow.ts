import type { Application } from './types';
import type { QueueItem } from './application-queue';

export type WorkflowPhase = 'idle' | 'waiting' | 'opening' | 'filling' | 'login' | 'account' | 'verification' | 'navigation' | 'blocked' | 'needs-answers' | 'review' | 'submitted' | 'abandoned';

/** Shared presentation of persisted state, not a second queue scheduler or source of truth.
 * Callers supply only the application/item belonging to the current tab and attempt.
 */
export function applicationWorkflow(app?: Application, item?: QueueItem) {
  // A queue retry can coexist briefly with its previous application summary. The new
  // attempt owns the controls until its result is persisted; old results cannot unlock capture.
  let phase: WorkflowPhase;
  if (item?.state === 'needs-action' && item.waitingFor) phase = item.waitingFor;
  else if (item?.state === 'opening') phase = 'opening';
  else if (item?.state === 'filling') phase = 'filling';
  else if (item?.state === 'needs-action') phase = 'blocked';
  else if (item?.state === 'queued') phase = 'waiting';
  else if (item?.state === 'submitted') phase = 'submitted';
  else if (item?.state === 'skipped') phase = 'abandoned';
  else if (app?.status === 'Submitted') phase = 'submitted';
  else if (app?.status === 'Abandoned') phase = 'abandoned';
  else if (item?.state === 'review') phase = app?.missingCount ? 'needs-answers' : 'review';
  else if (app?.status === 'Filling') phase = 'filling';
  else if (app?.status === 'Ready for review') phase = app.missingCount ? 'needs-answers' : 'review';
  else phase = 'idle';

  const reviewing = phase === 'needs-answers' || phase === 'review';
  const title: Record<WorkflowPhase, string> = {
    idle: 'Ready to fill', waiting: 'Waiting', opening: 'Opening application', filling: 'Filling',
    blocked: 'Needs your action', 'needs-answers': 'Needs answers', review: 'Ready for review',
    submitted: 'Submitted', abandoned: 'Abandoned',
    login: 'Sign in required', account: 'Create account', verification: 'Verification required', navigation: 'Return to application',
  };
  return {
    phase, title: title[phase],
    writing: phase === 'opening' || phase === 'filling',
    canRemember: reviewing && app?.status === 'Ready for review',
    canConfirmSubmission: (reviewing || phase === 'blocked' && !!item?.attempt && item.attempt === app?.runId) && !!app?.id && app.status === 'Ready for review',
    canFinishManually: phase === 'filling' && !!item?.applicationId,
  };
}
