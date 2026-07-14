import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  signInOptions,
  triggerManualSync,
  useAuthConfig,
  usePlatformHealth,
  useSessionUser,
} from '../api/client';

const REPO_URL = 'https://github.com/Hybrid-Solutions-Cloud/repo-wrangler';

export function Administration() {
  const { data: user } = useSessionUser();
  const { data: authConfig } = useAuthConfig();
  const signIns = signInOptions(authConfig);
  const health = usePlatformHealth();
  const [syncState, setSyncState] = useState<'idle' | 'ok' | 'error'>('idle');

  const isAdmin = user && (user.role === 'admin' || user.role === 'owner');
  const demoMode = health.data?.demoMode ?? true;

  async function onSync() {
    try {
      await triggerManualSync();
      setSyncState('ok');
    } catch {
      setSyncState('error');
    }
  }

  return (
    <>
      <h1 className="page-title">Administration</h1>
      <p className="page-subtitle">
        Connections, synchronization, and instance configuration for this deployment.
      </p>

      <div className="panel">
        <h2>Session</h2>
        {user ? (
          <p>
            Signed in as <strong>{user.login}</strong> with role{' '}
            <span className="badge info">{user.role}</span>
            {user.demo ? ' (demo session)' : ''}
          </p>
        ) : (
          <p className="muted">
            Not signed in. Sign in to access administrative actions:{' '}
            {signIns.map((s, i) => (
              <span key={s.href}>
                {i > 0 ? ' · ' : ''}
                <a href={s.href} style={{ color: 'inherit' }}>
                  {s.label}
                </a>
              </span>
            ))}
          </p>
        )}
      </div>

      <div className="panel">
        <h2>Provider connections</h2>
        {demoMode ? (
          <>
            <p>
              This instance is running in <span className="badge medium">demo mode</span> with
              synthetic data. Set <span className="mono">DEMO_MODE=false</span> and use the{' '}
              <Link to="/onboarding">onboarding wizard</Link> to connect GitHub or GitLab —
              credentials are entered in the UI, no vault pre-seeding required.
            </p>
            <p className="muted">
              Prefer environment variables instead? That path still works unchanged — follow{' '}
              <a href={`${REPO_URL}/blob/main/docs/setup/github-app.md`} target="_blank" rel="noreferrer">
                the GitHub App setup guide ↗
              </a>{' '}
              and{' '}
              <a href={`${REPO_URL}/blob/main/docs/setup/deploy-cloudflare.md`} target="_blank" rel="noreferrer">
                the deployment guide ↗
              </a>
              .
            </p>
          </>
        ) : (
          <p>
            {health.data?.connections.length ?? 0} connection(s) configured — status and last
            errors are on <Link to="/platform">Platform Health</Link>. Manage what's monitored on{' '}
            <Link to="/admin/estate-scope">Estate scope</Link>, or{' '}
            <Link to="/onboarding">connect another platform</Link>.
          </p>
        )}
      </div>

      <div className="panel">
        <h2>Synchronization</h2>
        <p className="muted">
          Enqueue a full discovery pass. It runs in bounded, checkpointed batches on the next
          scheduled ticks; webhooks keep individual repositories fresh between passes.
        </p>
        {isAdmin && !demoMode ? (
          <>
            <button onClick={onSync}>Run discovery now</button>
            {syncState === 'ok' && <span style={{ marginLeft: 10 }}>✓ Enqueued</span>}
            {syncState === 'error' && (
              <span style={{ marginLeft: 10 }} className="capability">
                Failed — check your role and connection.
              </span>
            )}
          </>
        ) : (
          <p className="muted">
            {demoMode
              ? 'Manual synchronization is unavailable in demo mode.'
              : 'Requires an admin or owner session.'}
          </p>
        )}
      </div>

      <div className="panel">
        <h2>Instance policy</h2>
        <p className="muted">
          Retention windows, branch exclusion patterns, and repository classifications currently
          ship as deployment configuration — see{' '}
          <a href={`${REPO_URL}/blob/main/docs/setup/deploy-cloudflare.md`} target="_blank" rel="noreferrer">
            the deployment guide ↗
          </a>
          . An in-app policy editor is tracked on the{' '}
          <a href={`${REPO_URL}/blob/main/ROADMAP.md`} target="_blank" rel="noreferrer">
            roadmap ↗
          </a>
          .
        </p>
      </div>
    </>
  );
}
