import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  signInOptions,
  triggerManualSync,
  updateSessionPolicy,
  useAuthConfig,
  usePlatformHealth,
  useSessionUser,
  useSessionPolicy,
} from '../api/client';

export function Administration() {
  const { data: user } = useSessionUser();
  const { data: authConfig } = useAuthConfig();
  const signIns = signInOptions(authConfig);
  const health = usePlatformHealth();
  const [syncState, setSyncState] = useState<'idle' | 'ok' | 'error'>('idle');
  const sessionPolicy = useSessionPolicy(Boolean(user && (user.role === 'admin' || user.role === 'owner')));
  const [sessionMode, setSessionMode] = useState<'browser' | 'fixed'>('fixed');
  const [timeoutMinutes, setTimeoutMinutes] = useState('720');
  const [sessionSaveState, setSessionSaveState] = useState<'idle' | 'saving' | 'ok' | 'error'>('idle');

  const isAdmin = user && (user.role === 'admin' || user.role === 'owner');
  const demoMode = health.data?.demoMode ?? true;

  useEffect(() => {
    if (!sessionPolicy.data) return;
    setSessionMode(sessionPolicy.data.mode);
    if (sessionPolicy.data.timeoutMinutes !== null) {
      setTimeoutMinutes(String(sessionPolicy.data.timeoutMinutes));
    }
  }, [sessionPolicy.data]);

  async function onSync() {
    try {
      await triggerManualSync();
      setSyncState('ok');
    } catch {
      setSyncState('error');
    }
  }

  async function onSaveSessionPolicy() {
    setSessionSaveState('saving');
    try {
      await updateSessionPolicy(sessionMode === 'browser'
        ? { mode: 'browser' }
        : { mode: 'fixed', timeoutMinutes: Number(timeoutMinutes) });
      await sessionPolicy.refetch();
      setSessionSaveState('ok');
    } catch {
      setSessionSaveState('error');
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
          <>
            <p>
              Signed in as <strong>{user.login}</strong> with role{' '}
              <span className="badge info">{user.role}</span>
              {user.demo ? ' (demo session)' : ''}
            </p>
            {isAdmin && !user.demo && (
              <div className="field" style={{ maxWidth: 460 }}>
                <label htmlFor="session-mode">Sign-in duration</label>
                <select
                  id="session-mode"
                  value={sessionMode}
                  onChange={(event) => {
                    setSessionMode(event.target.value as 'browser' | 'fixed');
                    setSessionSaveState('idle');
                  }}
                >
                  <option value="browser">Until the browser closes</option>
                  <option value="fixed">Fixed duration</option>
                </select>
                {sessionMode === 'fixed' && (
                  <>
                    <label htmlFor="session-timeout">Duration in minutes</label>
                    <input
                      id="session-timeout"
                      type="number"
                      min="5"
                      max="525600"
                      value={timeoutMinutes}
                      onChange={(event) => {
                        setTimeoutMinutes(event.target.value);
                        setSessionSaveState('idle');
                      }}
                    />
                  </>
                )}
                <p className="field-hint">
                  Browser sessions have no RepoWrangler time limit and are not stored as persistent
                  cookies. Fixed duration accepts 5 minutes through 365 days. Changes apply at the
                  next sign-in; Sign out and provider revocation always end access.
                </p>
                {sessionPolicy.data && (
                  <p className="field-hint">
                    Current policy source: {sessionPolicy.data.source === 'stored'
                      ? 'saved in RepoWrangler'
                      : sessionPolicy.data.source === 'deployment'
                        ? 'deployment configuration'
                        : 'product default'}.
                  </p>
                )}
                <div className="form-actions">
                  <button
                    type="button"
                    disabled={sessionSaveState === 'saving'}
                    onClick={() => void onSaveSessionPolicy()}
                  >
                    {sessionSaveState === 'saving' ? 'Saving…' : 'Save session policy'}
                  </button>
                  {sessionSaveState === 'ok' && <span>✓ Saved</span>}
                  {sessionSaveState === 'error' && (
                    <span className="capability">Could not save session policy.</span>
                  )}
                </div>
              </div>
            )}
          </>
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
              <a href="https://wranglerlabs.org/setup/github-app" target="_blank" rel="noreferrer">
                the GitHub App setup guide ↗
              </a>{' '}
              and{' '}
              <a href="https://wranglerlabs.org/setup/deploy-cloudflare" target="_blank" rel="noreferrer">
                the deployment guide ↗
              </a>
              .
            </p>
          </>
        ) : (
          <>
            <p>
              {health.data?.connections.length ?? 0} connection(s) configured. Manage credentials,
              health, provider access, and reconciliation in <Link to="/admin/connections">Connections</Link>.
              Choose monitored resources separately in <Link to="/admin/estate-scope">Estate scope</Link>.
            </p>
            <Link className="button-link" to="/admin/connections">Manage connections</Link>{' '}
            <Link className="button-link" to="/onboarding?add=1">Connect another platform</Link>
          </>
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
        <p><Link to="/admin/operations">View Operations history and retry failed jobs</Link></p>
      </div>

      <div className="panel">
        <h2>Instance policy</h2>
        <p className="muted">
          Retention windows, branch exclusion patterns, and repository classifications currently
          ship as deployment configuration — see{' '}
          <a href="https://wranglerlabs.org/setup/deploy-cloudflare" target="_blank" rel="noreferrer">
            the deployment guide ↗
          </a>
          . An in-app policy editor is tracked on the{' '}
          <a href="https://wranglerlabs.org/project/roadmap" target="_blank" rel="noreferrer">
            roadmap ↗
          </a>
          .
        </p>
      </div>

      <div className="panel">
        <h2>Application updates</h2>
        <p className="muted">
          Check release compatibility, run protected upgrades, follow controller progress,
          inspect verification evidence, and prepare rollback from one administration screen.
        </p>
        <Link className="button-link" to="/admin/updates">Manage updates</Link>
      </div>
    </>
  );
}
