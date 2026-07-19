import { describe, expect, it } from 'vitest';
import { isWorkerPath } from '../src/routing';

describe('Node host route ownership', () => {
  it('dispatches the complete GitHub App setup flow to the shared Worker app', () => {
    expect(isWorkerPath('/setup/github-app')).toBe(true);
    expect(isWorkerPath('/setup/github-app/callback')).toBe(true);
  });

  it('keeps SPA routes in the static host', () => {
    expect(isWorkerPath('/onboarding')).toBe(false);
    expect(isWorkerPath('/repositories/123')).toBe(false);
  });
});
