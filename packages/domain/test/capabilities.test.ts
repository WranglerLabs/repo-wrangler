import { describe, expect, it } from 'vitest';
import { capabilityStateFromHttpStatus } from '../src/capabilities';

describe('capabilityStateFromHttpStatus', () => {
  it('maps a plain 403 to not_authorized', () => {
    expect(capabilityStateFromHttpStatus(403)).toBe('not_authorized');
    expect(capabilityStateFromHttpStatus(403, { rateLimited: false })).toBe('not_authorized');
  });

  it('maps a rate-limited 403 to rate_limited, not not_authorized', () => {
    expect(capabilityStateFromHttpStatus(403, { rateLimited: true })).toBe('rate_limited');
  });

  it('leaves 401 as not_authorized regardless of the rateLimited flag', () => {
    expect(capabilityStateFromHttpStatus(401, { rateLimited: true })).toBe('not_authorized');
  });

  it('maps 404, 429, and 5xx as before', () => {
    expect(capabilityStateFromHttpStatus(404)).toBe('unsupported_by_provider');
    expect(capabilityStateFromHttpStatus(429)).toBe('rate_limited');
    expect(capabilityStateFromHttpStatus(503)).toBe('temporarily_unavailable');
    expect(capabilityStateFromHttpStatus(418)).toBe('error');
  });
});
