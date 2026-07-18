interface InitialAuthConfig {
  setupMode: boolean;
}

/** Resolve the only valid destinations from the unauthenticated sign-in page. */
export function initialSignInDestination(
  config: InitialAuthConfig | undefined,
  hasUser: boolean,
): '/' | '/onboarding' | undefined {
  if (config?.setupMode) return '/onboarding';
  if (hasUser) return '/';
  return undefined;
}

/**
 * Do not mount protected route components until public auth state is known.
 * During first boot only the setup wizard may render, preventing its sibling
 * pages from racing a 401 redirect to the normal sign-in screen.
 */
export function mayRenderInitialRoute(
  config: InitialAuthConfig | undefined,
  pathname: string,
): boolean {
  if (!config) return false;
  return !config.setupMode || pathname === '/onboarding';
}
