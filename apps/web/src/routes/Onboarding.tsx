import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { ConnectionDto } from '@repo-wrangler/contracts';
import {
  ApiError,
  connectGitLab,
  createGitLabWorkspaces,
  exchangeGitHubApp,
  pasteGitHubCredentials,
  searchGitLabGroups,
  setWorkspaceMonitoringState,
  triggerManualSync,
  useConnections,
  useConnectionWorkspaces,
  type MonitoringState,
} from '../api/client';
import { EstateScopeTable, type ScopeWorkspace } from '../components/EstateScopeTable';

type Platform = 'github' | 'gitlab';

const REPO_URL = 'https://github.com/Hybrid-Solutions-Cloud/repo-wrangler';
const WORKSPACE_POLL_MS = 10_000;

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

  const connections = useConnections();

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
    navigate('/');
  }

  return (
    <>
      <h1 className="page-title">Connect your estate</h1>
      <p className="page-subtitle">
        Step {step} of 4 — pick a platform, connect it, and choose what RepoWrangler watches.
      </p>

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
          <button onClick={finish} disabled={busy}>
            Go to Command Center
          </button>
          <p className="muted" style={{ marginTop: 12 }}>
            You can add another connection or change what's monitored any time from{' '}
            <strong>Administration → Estate scope</strong>. See the{' '}
            <a href={`${REPO_URL}/blob/main/docs/design/onboarding.md`} target="_blank" rel="noreferrer">
              onboarding design ↗
            </a>{' '}
            for details.
          </p>
        </div>
      )}
    </>
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
          <a href="/setup/github-app" target="_blank" rel="noreferrer">
            <button>Create the RepoWrangler GitHub App ↗</button>
          </a>
          <p className="muted" style={{ marginTop: 12 }}>
            After GitHub creates the app it shows you a one-time setup code. Paste it below to
            finish connecting — no other secrets ever leave your browser.
          </p>
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
