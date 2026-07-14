import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  connectGitLab,
  createGitLabWorkspaces,
  exchangeGitHubApp,
  pasteGitHubCredentials,
  searchGitLabGroups,
  setWorkspaceMonitoringState,
  triggerManualSync,
  useConnectionWorkspaces,
  type MonitoringState,
} from '../api/client';
import { EstateScopeTable, type ScopeWorkspace } from '../components/EstateScopeTable';

type Platform = 'github' | 'gitlab';

const REPO_URL = 'https://github.com/Hybrid-Solutions-Cloud/repo-wrangler';

/**
 * Onboarding design B2 — the first-run wizard. "Connect" *is* "enter, or
 * one-tap-create, the credentials in the UI" (the design's Credential entry
 * requirement) — this page never asks an operator to pre-seed a vault.
 */
export function Onboarding() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [platformIndex, setPlatformIndex] = useState(0);
  const [connectionIds, setConnectionIds] = useState<Partial<Record<Platform, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const currentPlatform = platforms[platformIndex];
  const currentConnectionId = currentPlatform ? connectionIds[currentPlatform] : undefined;

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
        />
      )}

      {step === 2 && currentPlatform === 'gitlab' && (
        <GitLabConnectStep
          busy={busy}
          setBusy={setBusy}
          setError={setError}
          onConnected={(id) => advanceAfterConnect('gitlab', id)}
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
}

function GitHubConnectStep({ busy, setBusy, setError, onConnected }: ConnectStepProps) {
  const [mode, setMode] = useState<'create' | 'paste' | null>(null);
  const [code, setCode] = useState('');
  const [appId, setAppId] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');

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

function GitLabConnectStep({ busy, setBusy, setError, onConnected }: ConnectStepProps) {
  const [baseUrl, setBaseUrl] = useState('https://gitlab.com');
  const [token, setToken] = useState('');
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ externalId: string; fullPath: string; name: string; projectCount?: number }[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [searching, setSearching] = useState(false);

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
