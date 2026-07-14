import { describe, expect, it } from 'vitest';
import { isSecondaryRateLimited, type GitHubResponse } from '../src/client';

function response(overrides: Partial<GitHubResponse<unknown>>): GitHubResponse<unknown> {
  return {
    ok: false,
    status: 403,
    rateLimit: {},
    ...overrides,
  };
}

describe('isSecondaryRateLimited', () => {
  it('is true for a 403 with a Retry-After header', () => {
    expect(isSecondaryRateLimited(response({ rateLimit: { retryAfter: 30 } }))).toBe(true);
  });

  it('is true for a 403 with x-ratelimit-remaining: 0', () => {
    expect(isSecondaryRateLimited(response({ rateLimit: { remaining: 0 } }))).toBe(true);
  });

  it('is false for a plain 403 with no rate-limit signal', () => {
    expect(isSecondaryRateLimited(response({ rateLimit: { remaining: 42 } }))).toBe(false);
  });

  it('is false for a non-403 status even with a zeroed remaining count', () => {
    expect(isSecondaryRateLimited(response({ status: 401, rateLimit: { remaining: 0 } }))).toBe(
      false,
    );
  });
});
