/** Review metadata never contains applicant values. Tokens belong to one live fill session. */
export interface FieldFeedback {
  token: string;
  label: string;
  required: boolean;
  status: 'verified' | 'review' | 'missing' | 'entered' | 'optional';
  source: 'profile' | 'memory' | 'preset' | 'ai' | 'page' | 'none';
  reason: string;
}
export const FIELD_STATUS_LABELS: Record<FieldFeedback['status'], string> = {
  verified: 'Verified', review: 'Review', missing: 'Missing', entered: 'Entered by you', optional: 'Optional',
};
export function feedbackPriority(field: Pick<FieldFeedback, 'status' | 'required'>): number {
  return field.status === 'missing' ? field.required ? 0 : 1 : field.status === 'review' ? 2 : field.status === 'optional' ? 4 : 5;
}
export function parseFieldFeedback(value: unknown): FieldFeedback[] {
  if (!Array.isArray(value) || value.length > 200) throw new Error('Invalid field feedback.');
  const tokens = new Set<string>();
  return value.map(raw => {
    const f = raw as FieldFeedback | undefined;
    if (!f || typeof f.token !== 'string' || !/^[a-z0-9-]{1,100}$/i.test(f.token) || tokens.has(f.token) ||
      typeof f.label !== 'string' || !f.label.trim() || f.label.length > 700 || typeof f.required !== 'boolean' ||
      !['verified', 'review', 'missing', 'entered', 'optional'].includes(f.status) ||
      !['profile', 'memory', 'preset', 'ai', 'page', 'none'].includes(f.source) ||
      typeof f.reason !== 'string' || f.reason.length > 300) throw new Error('Invalid field feedback.');
    tokens.add(f.token);
    return { token: f.token, label: f.label, required: f.required, status: f.status, source: f.source, reason: f.reason };
  });
}
