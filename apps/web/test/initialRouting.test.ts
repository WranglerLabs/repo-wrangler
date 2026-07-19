import { describe, expect, it } from 'vitest';
import { initialSignInDestination, mayRenderInitialRoute } from '../src/routes/initialRouting';

describe('initial setup routing', () => {
  it('sends an unconfigured real deployment from sign-in to onboarding', () => {
    expect(initialSignInDestination({ setupMode: true, providers: [] }, false)).toBe('/onboarding');
  });

  it('keeps the sign-in page available while configured identity awaits its first successful login', () => {
    expect(initialSignInDestination({ setupMode: true, providers: [{ id: 'entra' }] }, false)).toBeUndefined();
  });

  it('returns an authenticated non-setup session to the application', () => {
    expect(initialSignInDestination({ setupMode: false }, true)).toBe('/');
    expect(initialSignInDestination({ setupMode: false }, false)).toBeUndefined();
  });

  it('blocks protected routes until auth state is known', () => {
    expect(mayRenderInitialRoute(undefined, '/')).toBe(false);
    expect(mayRenderInitialRoute({ setupMode: true }, '/')).toBe(false);
  });

  it('renders only onboarding while initial setup is active', () => {
    expect(mayRenderInitialRoute({ setupMode: true }, '/onboarding')).toBe(true);
    expect(mayRenderInitialRoute({ setupMode: false }, '/')).toBe(true);
  });
});
