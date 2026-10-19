import { describe, expect, it } from 'vitest';
import { defaultScope } from '../components/KnowledgeBase';

const context = { url: 'https://jobs.example.com/apple/123', company: 'Apple' } as never;

describe('defaultScope', () => {
  it('uses all applications for questions that are not company specific', () => {
    expect(defaultScope('Are you willing to relocate to San Francisco?', context)).toBe('all');
    expect(defaultScope('Do you have experience with TypeScript?', context)).toBe('all');
  });
  it('uses the company for company-specific questions', () => {
    expect(defaultScope('Have you worked for Apple before?', context)).toMatch(/^company:/);
    expect(defaultScope('Do you have friends at Apple?', context)).toMatch(/^company:/);
    expect(defaultScope('Have you ever worked for us?', context)).toMatch(/^company:/);
  });
});
