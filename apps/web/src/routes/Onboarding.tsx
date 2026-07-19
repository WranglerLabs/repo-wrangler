import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { createGitHubAppManifest, supportsEntraWebRedirect, supportsGitHubWebhooks, type ConnectionDto } from '@repo-wrangler/contracts';
import type { AuthProviderOption } from '../api/client';
import {
  ApiError,
  authorizeSetup,
  clearStoredSetupToken,
  configureIdentity,
  connectGitLab,
  createGitLabWorkspaces,
  exchangeGitHubApp,
  pasteGitHubCredentials,
  searchGitLabGroups,
  setWorkspaceMonitoringState,
  hasStoredSetupToken,
  triggerManualSync,
  useAuthConfig,
  useConnections,
  useConnectionWorkspaces,
  useIdentityConfiguration,
  type MonitoringState,
} from '../api/client';
import { EstateScopeTable, type ScopeWorkspace } from '../components/EstateScopeTable';

type Platform = 'github' | 'gitlab';

const WORKSPACE_POLL_MS = 10_000;

function randomAppSuffix(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 6);
}

/**
 * Onboarding design B2 — the first-run wizard. "Connect" *is* "enter, or
 * one-tap-create, the credentials in the UI" (the design's Credential entry
 * requirement) — this page never asks an operator to pre-seed a vault.
 *
 * Wizard-loop fix: a fresh mount — including the landing after the GitHub
 * App manifest callback redirects here — must never re-show "pick a
 * platform" for a platform that already has an active connection. The
 * hydration effect below detects that case from `GET /connections` and jumps
 * straight to the connect step, which renders its connected state (and, for
 * GitHub, the install-app guidance) instead of the create/connect choices.
 * `/onboarding?add=1` (the "connect another platform" links) opts out of
 * hydration so an already-onboarded operator can still add a second provider.
 */
export function Onboarding() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const forceNewConnection = searchParams.get('add') === '1';

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [platformIndex, setPlatformIndex] = useState(0);
  const [connectionIds, setConnectionIds] = useState<Partial<Record<Platform, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hydrated, setHydrated] = useState(forceNewConnection);
  const [setupAuthorized, setSetupAuthorized] = useState(hasStoredSetupToken);
  const [identitySelected, setIdentitySelected] = useState(forceNewConnection);

  const authConfig = useAuthConfig();
  const setupTokenRequired = authConfig.data?.setupTokenRequired === true;
  const connections = useConnections(
    Boolean(authConfig.data) && (!setupTokenRequired || setupAuthorized),
  );
  const identityConfiguration = useIdentityConfiguration(
    Boolean(authConfig.data) && (!setupTokenRequired || setupAuthorized) && !forceNewConnection,
  );

  useEffect(() => {
    if (identityConfiguration.data?.selectedProvider) setIdentitySelected(true);
  }, [identityConfiguration.data?.selectedProvider]);

  useEffect(() => {
    const setupError = connections.error ?? identityConfiguration.error;
    if (setupTokenRequired && setupError instanceof ApiError && setupError.status === 401) {
      clearStoredSetupToken();
      setSetupAuthorized(false);
    }
  }, [setupTokenRequired, connections.error, identityConfiguration.error]);

  useEffect(() => {
    if (authConfig.data && !authConfig.data.setupMode) clearStoredSetupToken();
  }, [authConfig.data]);

  // The finish step must judge sign-in readiness on credentials stored
  // DURING this wizard run, not on a config cached at first paint (the
  // auth-config query is otherwise cached forever).
  useEffect(() => {
    if (step === 4) void queryClient.invalidateQueries({ queryKey: ['auth-config'] });
  }, [step, queryClient]);

  // Every mount must see fresh connection state, not a stale cache from
  // before the GitHub App exchange completed — otherwise the hydration
  // effect below would judge the "does a connection already exist?"
  // question on data that predates the callback that just landed here.
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: ['connections'] });
    void queryClient.invalidateQueries({ queryKey: ['onboarding-status'] });
    // Run once per mount only — this is a landing-freshness refetch, not a
    // response to `connections`/`queryClient` changing.
  }, []);

  // Resume, don't re-ask: if an active connection already exists for a
  // platform, skip past "pick a platform" and the create/paste choices to
  // that platform's connect step.
  useEffect(() => {
    if (hydrated || connections.isLoading || !connections.data) return;
    const active = connections.data.filter((c) => c.status === 'active');
    if (active.length > 0) {
      const detected: Platform[] = [];
      const ids: Partial<Record<Platform, string>> = {};
      for (const platform of ['github', 'gitlab'] as const) {
        const match = active.find((c) => c.provider === platform);
        if (match) {
          detected.push(platform);
          ids[platform] = match.id;
        }
      }
      setPlatforms(detected);
      setConnectionIds(ids);
      setPlatformIndex(0);
      setStep(2);
    }
    setHydrated(true);
  }, [hydrated, connections.isLoading, connections.data]);

  const currentPlatform = platforms[platformIndex];
  const currentConnectionId = currentPlatform ? connectionIds[currentPlatform] : undefined;
  const currentConnection = connections.data?.find((c) => c.id === currentConnectionId);

  function togglePlatform(p: Platform) {
    setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  }

  function advanceAfterConnect(platform: Platform, connectionId: string) {
    setConnectionIds((prev) => ({ ...prev, [platform]: connectionId }));
    setError(null);
    setStep(3);
  }

  function nextPlatformOrFinish() {
    if (platformIndex + 1 < platforms.length) {
      setPlatformIndex((i) => i + 1);
      setStep(2);
    } else {
      setStep(4);
    }
  }

  async function finish() {
    setBusy(true);
    try {
      await triggerManualSync();
    } catch {
      // A first discovery pass is a convenience, not a requirement — the
      // scheduled reconciliation picks it up regardless.
    }
    await queryClient.invalidateQueries({ queryKey: ['onboarding-status'] });
    await queryClient.invalidateQueries({ queryKey: ['auth-config'] });
    const currentAuth = queryClient.getQueryData<{ providers: AuthProviderOption[] }>(['auth-config']);
    if (currentAuth && currentAuth.providers.some((provider) => provider.id !== 'local')) {
      clearStoredSetupToken();
      window.location.assign('/sign-in');
      return;
    }
    navigate('/');
  }

  if (authConfig.isLoading || (!forceNewConnection && identityConfiguration.isLoading)) {
    return <p className="muted">Loading secure setup…</p>;
  }

  if (authConfig.error) {
    return <div className="error-box">Could not load the sign-in configuration. Is the API reachable?</div>;
  }

  if (setupTokenRequired && !setupAuthorized) {
    return <SetupTokenGate onAuthorized={() => setSetupAuthorized(true)} />;
  }

  if (!identitySelected) {
    return (
      <IdentitySetup
        busy={busy}
        error={error}
        onGitHub={async (allowedUsers) => {
          setBusy(true);
          setError(null);
          try {
            await configureIdentity({ provider: 'github', allowedUsers });
            setPlatforms((current) => current.includes('github') ? current : ['github', ...current]);
            setIdentitySelected(true);
          } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Could not select GitHub identity.');
          } finally {
            setBusy(false);
          }
        }}
        onEntra={async (input) => {
          setBusy(true);
          setError(null);
          try {
            await configureIdentity(input);
            setIdentitySelected(true);
          } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Could not configure Microsoft Entra ID.');
          } finally {
            setBusy(false);
          }
        }}
      />
    );
  }

  return (
    <>
      <h1 className="page-title">Connect your estate</h1>
      <p className="page-subtitle">
        Step {step} of 4 — pick a platform, connect it, and choose what RepoWrangler watches.
      </p>

      {!forceNewConnection && authConfig.data?.setupMode && (
        <button className="ghost" onClick={() => { setError(null); setIdentitySelected(false); }}>
          Change administrator identity
        </button>
      )}

      {error && <div className="error-box">{error}</div>}

      {step === 1 && (
        <div className="panel">
          <h2>Which platform(s) do you want to monitor?</h2>
          <p className="muted">Each is an independent connection — select one or both.</p>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0' }}>
            <input
              type="checkbox"
              checked={platforms.includes('github')}
              onChange={() => togglePlatform('github')}
            />
            GitHub
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0' }}>
            <input
              type="checkbox"
              checked={platforms.includes('gitlab')}
              onChange={() => togglePlatform('gitlab')}
            />
            GitLab
          </label>
          <button
            disabled={platforms.length === 0}
            onClick={() => {
              setPlatformIndex(0);
              setStep(2);
            }}
          >
            Continue
          </button>
        </div>
      )}

      {step === 2 && currentPlatform === 'github' && (
        <GitHubConnectStep
          busy={busy}
          setBusy={setBusy}
          setError={setError}
          onConnected={(id) => advanceAfterConnect('github', id)}
          existingConnection={currentConnection}
        />
      )}

      {step === 2 && currentPlatform === 'gitlab' && (
        <GitLabConnectStep
          busy={busy}
          setBusy={setBusy}
          setError={setError}
          onConnected={(id) => advanceAfterConnect('gitlab', id)}
          existingConnection={currentConnection}
        />
      )}

      {step === 3 && currentPlatform && currentConnectionId && (
        <ScopeStep
          platform={currentPlatform}
          connectionId={currentConnectionId}
          onContinue={nextPlatformOrFinish}
        />
      )}

      {step === 4 && (
        <div className="panel">
          <h2>Finish</h2>
          <p>
            {Object.keys(connectionIds).length} connection(s) configured. A first discovery pass
            is starting now; newly discovered repositories appear as they are found.
          </p>
          <SignInReadiness
            loading={authConfig.isLoading}
            providers={(authConfig.data?.providers ?? []).filter((p) => p.id !== 'local')}
          />
          <button onClick={finish} disabled={busy}>
            Go to Command Center
          </button>
          <p className="muted" style={{ marginTop: 12 }}>
            You can add another connection or change what's monitored any time from{' '}
            <strong>Administration → Estate scope</strong>. See the{' '}
            <a href="https://wranglerlabs.org/design/onboarding" target="_blank" rel="noreferrer">
              onboarding design ↗
            </a>{' '}
            for details.
          </p>
        </div>
      )}
    </>
  );
}

function IdentitySetup({
  busy,
  error,
  onGitHub,
  onEntra,
}: {
  busy: boolean;
  error: string | null;
  onGitHub: (allowedUsers: string) => Promise<void>;
  onEntra: (input: {
    provider: 'entra';
    tenantId: string;
    clientId: string;
    clientSecret: string;
    allowedUsers: string;
  }) => Promise<void>;
}) {
  const [choice, setChoice] = useState<'github' | 'entra' | null>(null);
  const [githubUsers, setGitHubUsers] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [allowedUsers, setAllowedUsers] = useState('');
  const entraAvailable = supportsEntraWebRedirect(window.location.origin);

  async function saveEntra() {
    await onEntra({ provider: 'entra', tenantId, clientId, clientSecret, allowedUsers });
  }

  return (
    <>
      <h1 className="page-title">Protect administrator access</h1>
      <p className="page-subtitle">
        Choose how administrators sign in before connecting repositories and selecting monitored resources.
      </p>
      {error && <div className="error-box">{error}</div>}
      <div className="panel">
        <h2>Administrator identity provider</h2>
        <p className="muted">
          This controls access to RepoWrangler. Estate connections are configured separately afterward.
        </p>
        <button className={choice === 'github' ? '' : 'ghost'} onClick={() => setChoice('github')}>
          GitHub identity
        </button>
        <button className={choice === 'entra' ? '' : 'ghost'} disabled={!entraAvailable} onClick={() => setChoice('entra')}>
          Microsoft Entra ID
        </button>
        {!entraAvailable && (
          <p className="muted">
            Microsoft Entra ID requires trusted HTTPS when RepoWrangler is not on loopback.
            Configure HTTPS first, or use GitHub identity for this private HTTP deployment.
          </p>
        )}
        {choice === 'github' && (
          <div style={{ marginTop: 16 }}>
            <p>
              The GitHub App created in the next stage supplies administrator OAuth sign-in.
              Its read-only estate access is configured separately in that stage.
            </p>
            <label className="field">
              GitHub administrator usernames (comma-separated; first is owner)
              <input value={githubUsers} onChange={(event) => setGitHubUsers(event.target.value)} />
            </label>
            <button disabled={busy || !githubUsers.trim()} onClick={() => void onGitHub(githubUsers)}>
              {busy ? 'Saving…' : 'Continue with GitHub identity'}
            </button>
          </div>
        )}
        {choice === 'entra' && (
          <div style={{ marginTop: 16 }}>
            <p>
              Create an Entra app registration with web redirect URI{' '}
              <code>{window.location.origin}/auth/entra/callback</code>, then enter its values here.
              The client secret is encrypted in RepoWrangler's database.
            </p>
            <label className="field">Tenant ID<input value={tenantId} onChange={(event) => setTenantId(event.target.value)} /></label>
            <label className="field">Client ID<input value={clientId} onChange={(event) => setClientId(event.target.value)} /></label>
            <label className="field">Client secret<input type="password" value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} /></label>
            <label className="field">Administrator emails (comma-separated; first is owner)<input value={allowedUsers} onChange={(event) => setAllowedUsers(event.target.value)} /></label>
            <button disabled={busy || !tenantId.trim() || !clientId.trim() || !clientSecret.trim() || !allowedUsers.trim()} onClick={() => void saveEntra()}>
              {busy ? 'Saving…' : 'Continue with Entra identity'}
            </button>
          </div>
        )}
      </div>
    </>
  );
}

function SetupTokenGate({ onAuthorized }: { onAuthorized: () => void }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function unlock() {
    setBusy(true);
    setError(null);
    try {
      await authorizeSetup(token);
      onAuthorized();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Setup token rejected.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="page-title">Secure initial setup</h1>
      <p className="page-subtitle">Enter the setup token configured by this deployment.</p>
      <div className="panel">
        {error && <div className="error-box">{error}</div>}
        <label className="field mono-field">
          Setup token
          <input
            type="password"
            autoComplete="off"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && void unlock()}
          />
        </label>
        <button onClick={() => void unlock()} disabled={busy || !token}>
          {busy ? 'Checking…' : 'Continue'}
        </button>
      </div>
    </>
  );
}

/**
 * Setup must never end with a locked front door: on a fresh real-mode
 * install the request-scoped setup identity disappears as soon as a real
 * provider works. The durable setup latch prevents that door reopening later.
 * The finish step states plainly whether real sign-in works — and how to
 * fix it before leaving the wizard if it doesn't.
 */
function SignInReadiness({
  loading,
  providers,
}: {
  loading: boolean;
  providers: AuthProviderOption[];
}) {
  if (loading) return <p className="muted">Checking sign-in configuration…</p>;
  if (providers.length > 0) {
    return (
      <p>
        ✓ Sign-in is configured — {providers.map((p) => p.label).join(', ')}. Finish here, then
        successfully sign in with {providers.map((p) => p.label).join(' or ')}. Initial setup
        access closes permanently only after that first verified administrator sign-in.
      </p>
    );
  }
  return (
    <div className="error-box">
      <strong>No sign-in provider is configured.</strong> Setup remains available, but you cannot
      enter the dashboard normally yet. For GitHub: open your GitHub App's settings, generate a client
      secret, then add the OAuth client ID and secret via{' '}
      <a href="/onboarding?add=1">Connect → I already have a GitHub App</a> before you finish.
    </div>
  );
}

interface ConnectStepProps {
  busy: boolean;
  setBusy: (b: boolean) => void;
  setError: (e: string | null) => void;
  onConnected: (connectionId: string) => void;
  /** Set when hydration found an already-active connection for this platform. */
  existingConnection?: ConnectionDto;
}

function GitHubConnectStep({ busy, setBusy, setError, onConnected, existingConnection }: ConnectStepProps) {
  const [mode, setMode] = useState<'create' | 'paste' | null>(null);
  const [code, setCode] = useState('');
  const [appId, setAppId] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [organization, setOrganization] = useState('');
  const [manifest] = useState(() =>
    JSON.stringify(createGitHubAppManifest(window.location.origin, randomAppSuffix())),
  );

  // Polls while no installation exists yet — the step advances itself the
  // moment one appears (auto-triggered discovery on the server means this
  // usually only takes one or two ticks after the operator installs).
  const workspaces = useConnectionWorkspaces(existingConnection?.id, {
    refetchInterval: WORKSPACE_POLL_MS,
  });

  async function exchange() {
    setBusy(true);
    setError(null);
    try {
      const result = await exchangeGitHubApp(code.trim());
      onConnected(result.connectionId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not exchange the setup code.');
    } finally {
      setBusy(false);
    }
  }

  async function paste() {
    setBusy(true);
    setError(null);
    try {
      const result = await pasteGitHubCredentials({
        appId: appId.trim(),
        privateKey: privateKey.trim(),
        webhookSecret: webhookSecret.trim(),
        clientId: clientId.trim() || undefined,
        clientSecret: clientSecret.trim() || undefined,
      });
      onConnected(result.connectionId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the GitHub App credentials.');
    } finally {
      setBusy(false);
    }
  }

  if (existingConnection) {
    const hasInstallation = (workspaces.data?.length ?? 0) > 0;
    return (
      <div className="panel">
        <h2>Connect GitHub</h2>
        <p>
          <strong>{existingConnection.displayName}</strong> ✓ connected
        </p>
        {hasInstallation ? (
          <>
            <p className="muted">The app is installed and ready.</p>
            <button onClick={() => onConnected(existingConnection.id)}>Continue</button>
          </>
        ) : (
          <>
            <p>
              Creating the app is not the same as installing it. GitHub only starts sending
              RepoWrangler data once you choose which organization(s) or account the app can
              read — that's a separate step, on GitHub's side.
            </p>
            {existingConnection.installUrl ? (
              <a href={existingConnection.installUrl} target="_blank" rel="noreferrer">
                <button>Install the app on GitHub ↗</button>
              </a>
            ) : (
              <p className="muted">
                Open this GitHub App under your account or organization's settings and install
                it on at least one account.
              </p>
            )}
            <p className="muted" style={{ marginTop: 12 }}>
              Waiting for an installation… this page checks automatically every few seconds, no
              need to come back and click anything.
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="panel">
      <h2>Connect GitHub</h2>
      {!mode && (
        <>
          <p>
            Create a dedicated, read-only GitHub App with everything RepoWrangler needs already
            configured — one tap, no manual permission setup.
          </p>
          <form action="https://github.com/settings/apps/new" method="post" target="_blank">
            <input type="hidden" name="manifest" value={manifest} />
            <button type="submit">Create under my GitHub account ↗</button>
          </form>
          <form
            action={`https://github.com/organizations/${encodeURIComponent(organization.trim())}/settings/apps/new`}
            method="post"
            target="_blank"
            onSubmit={(event) => {
              if (!organization.trim()) event.preventDefault();
            }}
          >
            <input type="hidden" name="manifest" value={manifest} />
            <label className="field">
              Or create under a GitHub organization
              <input
                type="text"
                value={organization}
                onChange={(event) => setOrganization(event.target.value)}
                placeholder="organization login"
              />
            </label>
            <button type="submit" disabled={!organization.trim()}>
              Create under this organization ↗
            </button>
          </form>
          <p className="muted" style={{ marginTop: 12 }}>
            RepoWrangler posts the public App manifest directly to GitHub. It does not open an
            intermediate local setup page. After GitHub creates the app, return here with the
            one-time setup code to finish connecting.
          </p>
          {!supportsGitHubWebhooks(window.location.origin) && (
            <p className="muted">
              This deployment is not on public HTTPS, so the App is created without a webhook.
              RepoWrangler will discover changes through scheduled and manual synchronization.
              Webhooks can be enabled later after you configure a publicly reachable HTTPS URL.
            </p>
          )}
          <button className="ghost" onClick={() => setMode('create')}>
            I have a setup code
          </button>
          <button className="ghost" onClick={() => setMode('paste')}>
            I already have a GitHub App — paste its credentials instead
          </button>
        </>
      )}

      {mode === 'create' && (
        <>
          <label className="field mono-field">
            Setup code
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="the code GitHub showed you"
            />
          </label>
          <div className="form-actions">
            <button onClick={exchange} disabled={busy || !code.trim()}>
              {busy ? 'Connecting…' : 'Finish connecting'}
            </button>
            <button className="ghost" onClick={() => setMode(null)} disabled={busy}>
              Back
            </button>
          </div>
        </>
      )}

      {mode === 'paste' && (
        <>
          <label className="field mono-field">
            App ID
            <input
              type="text"
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
              placeholder="e.g. 987654"
            />
          </label>
          <label className="field mono-field">
            Private key (PEM)
            <textarea
              rows={8}
              value={privateKey}
              onChange={(e) => setPrivateKey(e.target.value)}
              placeholder="-----BEGIN RSA PRIVATE KEY-----"
            />
          </label>
          <label className="field mono-field">
            Webhook secret
            <input
              type="password"
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
            />
          </label>

          <div className="field-group-heading">Optional — enables GitHub sign-in</div>
          <label className="field mono-field">
            OAuth client ID
            <input
              type="text"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="Iv1.…"
            />
          </label>
          <label className="field mono-field">
            OAuth client secret
            <input
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
            />
          </label>

          <div className="form-actions">
            <button onClick={paste} disabled={busy || !appId.trim() || !privateKey.trim() || !webhookSecret.trim()}>
              {busy ? 'Saving…' : 'Save and connect'}
            </button>
            <button className="ghost" onClick={() => setMode(null)} disabled={busy}>
              Back
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function GitLabConnectStep({ busy, setBusy, setError, onConnected, existingConnection }: ConnectStepProps) {
  const [baseUrl, setBaseUrl] = useState('https://gitlab.com');
  const [token, setToken] = useState('');
  const [connectionId, setConnectionId] = useState<string | null>(existingConnection?.id ?? null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ externalId: string; fullPath: string; name: string; projectCount?: number }[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [searching, setSearching] = useState(false);

  // Same purpose as the GitHub branch's poll: an already-connected GitLab
  // connection with groups already selected should land on "connected,
  // Continue" — not ask the operator to re-enter a token.
  const workspaces = useConnectionWorkspaces(connectionId ?? undefined);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const result = await connectGitLab(baseUrl.trim() || 'https://gitlab.com', token.trim());
      setConnectionId(result.connectionId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not connect to GitLab.');
    } finally {
      setBusy(false);
    }
  }

  async function search() {
    if (!connectionId || !query.trim()) return;
    setSearching(true);
    try {
      const groups = await searchGitLabGroups(connectionId, query.trim());
      setResults(groups);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'GitLab group search failed.');
    } finally {
      setSearching(false);
    }
  }

  function toggleSelected(fullPath: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(fullPath)) next.delete(fullPath);
      else next.add(fullPath);
      return next;
    });
  }

  async function createSelectedWorkspaces() {
    if (!connectionId || selected.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      await createGitLabWorkspaces(connectionId, [...selected]);
      onConnected(connectionId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the selected groups.');
    } finally {
      setBusy(false);
    }
  }

  if (connectionId && workspaces.isLoading) {
    return (
      <div className="panel">
        <h2>Connect GitLab</h2>
        <p className="muted">Checking connection…</p>
      </div>
    );
  }

  if (connectionId && (workspaces.data?.length ?? 0) > 0) {
    return (
      <div className="panel">
        <h2>Connect GitLab</h2>
        <p>
          <strong>GitLab — {existingConnection?.baseUrl ?? baseUrl}</strong> ✓ connected
        </p>
        <p className="muted">{workspaces.data!.length} group(s) already selected to monitor.</p>
        <button onClick={() => onConnected(connectionId)}>Continue</button>
      </div>
    );
  }

  if (!connectionId) {
    return (
      <div className="panel">
        <h2>Connect GitLab</h2>
        <label className="field">
          Base URL
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://gitlab.com"
          />
        </label>
        <label className="field mono-field">
          Personal or group access token (read_api scope)
          <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="glpat-…" />
        </label>
        <div className="form-actions">
          <button onClick={connect} disabled={busy || !token.trim()}>
            {busy ? 'Connecting…' : 'Validate and connect'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <h2>Choose GitLab groups</h2>
      <p className="muted">Search for the top-level groups (or subgroups) you want RepoWrangler to watch.</p>
      <div className="toolbar">
        <input
          type="search"
          placeholder="Search groups…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
        />
        <button onClick={search} disabled={searching || !query.trim()}>
          {searching ? 'Searching…' : 'Search'}
        </button>
      </div>
      {results.map((g) => (
        <label key={g.externalId} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0' }}>
          <input
            type="checkbox"
            checked={selected.has(g.fullPath)}
            onChange={() => toggleSelected(g.fullPath)}
          />
          {g.name} <span className="muted">({g.fullPath}{g.projectCount !== undefined ? ` · ${g.projectCount} projects` : ''})</span>
        </label>
      ))}
      <button onClick={createSelectedWorkspaces} disabled={busy || selected.size === 0} style={{ marginTop: 12 }}>
        {busy ? 'Adding…' : `Add ${selected.size || ''} group${selected.size === 1 ? '' : 's'}`}
      </button>
    </div>
  );
}

function ScopeStep({
  platform,
  connectionId,
  onContinue,
}: {
  platform: Platform;
  connectionId: string;
  onContinue: () => void;
}) {
  const workspaces = useConnectionWorkspaces(connectionId);
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<Set<string>>(new Set());

  async function toggleWorkspace(id: string, next: MonitoringState) {
    setPending((prev) => new Set(prev).add(id));
    try {
      await setWorkspaceMonitoringState(id, next);
      await queryClient.invalidateQueries({ queryKey: ['connection-workspaces', connectionId] });
    } finally {
      setPending((prev) => {
        const copy = new Set(prev);
        copy.delete(id);
        return copy;
      });
    }
  }

  const scopeWorkspaces: ScopeWorkspace[] = (workspaces.data ?? []).map((w) => ({
    id: w.id,
    slug: w.slug,
    displayName: w.displayName,
    kind: w.kind,
    monitoringState: w.monitoringState,
    repoCount: w.repoCount,
  }));

  return (
    <div className="panel">
      <h2>Choose what to monitor — {platform === 'github' ? 'GitHub' : 'GitLab'}</h2>
      {workspaces.isLoading && <p className="muted">Discovering organizations/groups…</p>}
      {workspaces.data && workspaces.data.length === 0 && (
        <p className="muted">
          Nothing found yet. For GitHub, make sure you installed the app on at least one
          organization with “All repositories”.
        </p>
      )}
      {scopeWorkspaces.length > 0 && (
        <EstateScopeTable
          workspaces={scopeWorkspaces}
          onToggleWorkspace={toggleWorkspace}
          pending={pending}
        />
      )}
      <button onClick={onContinue} style={{ marginTop: 12 }}>
        Continue
      </button>
    </div>
  );
}
