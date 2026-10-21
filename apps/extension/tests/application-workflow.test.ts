import { describe, expect, it } from 'vitest';
import { applicationWorkflow } from '../lib/application-workflow';
import { readSidebarOrder, readSidebarVisibility } from '../lib/sidebar-layout';
import type { Application } from '../lib/types';
import type { QueueItem } from '../lib/application-queue';

const app = (status: Application['status'] = 'Ready for review', missingCount = 0): Application => ({
  id: 1, url: 'https://example.com/jobs/1', jobKey: 'example-job', company: 'Fictional Company',
  role: 'Fictional Engineer', platform: 'other', status, filledAt: 1, aiAnswers: 0,
  filledCount: 2, missingCount, missingLabels: [],
});
const item = (state: QueueItem['state']): QueueItem => ({
  id: 'fictional-item', url: 'https://example.com/jobs/1', key: 'example-job',
  state, batch: 1, applicationId: 1,
});

describe('shared workflow presentation', () => {
  it('offers equivalent review actions for standalone and queued results', () => {
    for (const missing of [0, 3]) {
      const standalone = applicationWorkflow(app('Ready for review', missing));
      expect(applicationWorkflow(app('Ready for review', missing), item('review'))).toEqual(standalone);
      expect(standalone).toMatchObject({ phase: missing ? 'needs-answers' : 'review', writing: false, canRemember: true, canConfirmSubmission: true });
    }
  });
  it('does not unlock capture or submission using the old result during retry', () => {
    for (const state of ['opening', 'filling', 'queued', 'needs-action'] as const) {
      const view = applicationWorkflow(app(), item(state));
      expect(view.canRemember).toBe(false); expect(view.canConfirmSubmission).toBe(false);
    }
    expect(applicationWorkflow(app('Submitted'), item('filling')).phase).toBe('filling');
    expect(applicationWorkflow(app(), item('filling')).canFinishManually).toBe(true);
    expect(applicationWorkflow(undefined, { ...item('filling'), applicationId: undefined }).canFinishManually).toBe(false);
  });
  it('does not treat an empty form or completed fill as submission evidence', () => {
    expect(applicationWorkflow().phase).toBe('idle');
    expect(applicationWorkflow(app()).phase).toBe('review');
    expect(applicationWorkflow(app('Filling')).canConfirmSubmission).toBe(false);
    expect(applicationWorkflow(undefined, item('review')).canConfirmSubmission).toBe(false);
    expect(applicationWorkflow(app('Submitted'))).toMatchObject({ phase: 'submitted', canRemember: false, canConfirmSubmission: false });
    expect(applicationWorkflow(app('Abandoned')).phase).toBe('abandoned');
    expect(applicationWorkflow(app(), item('skipped')).phase).toBe('abandoned');
  });
  it('keeps the filling result locked until the persisted application also reaches review', () => {
    expect(applicationWorkflow(app('Filling'), item('review'))).toMatchObject({ writing: false, canRemember: false, canConfirmSubmission: false });
  });
});

describe('fixed Fill recovery control', () => {
  it('normalizes older orders without changing optional section relative order', () => {
    // 'presets' is a retired section: the preset selector now sits above Fill this page.
    expect(readSidebarOrder({ version: 1, order: ['presets', 'history', 'queue', 'fill', 'review', 'setup', 'track'] }))
      .toEqual(['fill', 'history', 'queue', 'review', 'setup', 'track']);
    expect(readSidebarVisibility({ version: 1, categories: { fill: false, history: false } })).toMatchObject({ fill: true, history: false });
  });
});
