import { useEffect } from 'react';
import { signInOptions, useAuthConfig, useSessionUser } from '../api/client';

/**
 * Owner-approved addition — the wizard's front door. Reached by the API
 * client's 401 handler (`apps/web/src/api/client.ts`), or directly, whenever
 * an unauthenticated real-mode session hits an authenticated endpoint. No
 * app chrome: an unauthenticated visitor has nothing to navigate to yet.
 */
export function SignIn() {
  const { data: authConfig, isLoading } = useAuthConfig();
  const { data: user } = useSessionUser();
  const signIns = signInOptions(authConfig);

  // Already signed in (e.g. reached /sign-in directly with a live session) —
  // send them straight back in, no dead end either direction.
  useEffect(() => {
    if (user) window.location.assign('/');
  }, [user]);

  return (
    <div style={{ maxWidth: 420, margin: '15vh auto', padding: '0 20px', textAlign: 'center' }}>
      <img src="/lasso.svg" alt="" width={40} height={40} />
      <h1 className="page-title">Sign in to RepoWrangler</h1>

      {isLoading && <p className="muted">Loading sign-in options…</p>}

      {!isLoading && authConfig && authConfig.providers.length === 0 && (
        <p className="muted">
          No sign-in method is configured yet — connect one via an admin. See{' '}
          <a
            href="https://github.com/Hybrid-Solutions-Cloud/repo-wrangler/blob/main/docs/providers/signin.md"
            target="_blank"
            rel="noreferrer"
          >
            the sign-in setup guide ↗
          </a>
          .
        </p>
      )}

      {!isLoading && authConfig && authConfig.providers.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 20 }}>
          {signIns.map((s) => (
            <a key={s.href} href={s.href}>
              <button style={{ width: '100%' }}>{s.label}</button>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
