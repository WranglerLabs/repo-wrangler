import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { ConnectionDto } from '@repo-wrangler/contracts';
import {
  ApiError,
  createGitLabWorkspaces,
  disconnectConnection,
  discoverConnectionWorkspaces,
  markEstateReviewed,
  rotateConnectionCredential,
  searchGitLabGroups,
  setRepositoryMonitoringState,
  setWorkspaceMonitoringState,
  triggerManualSync,
  useConnectionCredentials,
  useConnections,
  useEstateRepositories,
  useNewSinceReview,
  useWorkspaces,
  type MonitoringState,
} from '../api/client';
import { EstateScopeTable, type ScopeRepository, type ScopeWorkspace } from '../components/EstateScopeTable';

/**
 * Onboarding design B5 — the permanent Estate scope management screen. Same
 * `EstateScopeTable` component as the wizard's Step 3, against the full
 * `includeIgnored=true` listing, grouped by connection. "Add repos later" and
 * ongoing ignore/monitor decisions live here, not in a separate code path.
 */
export function EstateScope() {
  const connections = useConnections();
  const workspaces = useWorkspaces();
  const repositories = useEstateRepositories();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<Set<string>>(new Set());

  function withPending(id: string) {
    setPending((prev) => new Set(prev).add(id));
  }
  function clearPending(id: string) {
    setPending((prev) => {
      const copy = new Set(prev);
      copy.delete(id);
      return copy;
    });
  }

  async function invalidate() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['workspaces'] }),
      queryClient.invalidateQueries({ queryKey: ['estate-repositories'] }),
      queryClient.invalidateQueries({ queryKey: ['overview'] }),
    ]);
  }

  async function toggleWorkspace(id: string, next: MonitoringState) {
    withPending(id);
    try {
      await setWorkspaceMonitoringState(id, next);
      await invalidate();
    } finally {
      clearPending(id);
    }
  }

  async function toggleRepo(id: string, next: MonitoringState) {
    withPending(id);
    try {
      await setRepositoryMonitoringState(id, next);
      await invalidate();
    } finally {
      clearPending(id);
    }
  }

  return (
    <>
      <h1 className="page-title">Estate scope</h1>
      <p className="page-subtitle">
        Choose which organizations, groups, and repositories RepoWrangler monitors — the same
        controls as the onboarding wizard, available any time.{' '}
        <Link to="/onboarding?add=1">Connect another platform →</Link>
      </p>

      <NewSinceReviewBanner />

      {connections.data?.length === 0 && (
        <div className="panel">
          <p className="muted">No connections yet. Start with the onboarding wizard.</p>
          <Link to="/onboarding">
            <button>Connect a platform</button>
          </Link>
        </div>
      )}

      {connections.data?.map((connection) => {
        const connectionWorkspaces = (workspaces.data ?? []).filter(
          (w) => w.connectionId === connection.id,
        );
        const scopeWorkspaces: ScopeWorkspace[] = connectionWorkspaces.map((w) => ({
          id: w.id,
          slug: w.slug,
          displayName: w.displayName,
          kind: w.kind,
          monitoringState: w.monitoringState ?? 'monitored',
          repoCount: w.repositoryCount,
        }));
        const repositoriesByWorkspace: Record<string, ScopeRepository[]> = {};
        for (const w of connectionWorkspaces) {
          repositoriesByWorkspace[w.id] = (repositories.data ?? [])
            .filter((r) => r.workspaceId === w.id)
            .map((r) => ({
              id: r.id,
              fullName: r.fullName,
              monitoringState: r.monitoringState ?? 'monitored',
            }));
        }

        return (
          <details className="panel estate-connection" key={connection.id} open>
            <summary>
              <strong>{connection.provider === 'github' ? 'GitHub' : 'GitLab'} — {connection.displayName}</strong>
              <span className={`badge ${connection.status === 'active' ? 'info' : 'outline'}`} style={{ marginLeft: 8 }}>
                {connection.status}
              </span>
              <span className="estate-connection-count muted">
                {scopeWorkspaces.length} workspace{scopeWorkspaces.length === 1 ? '' : 's'}
              </span>
            </summary>
            <div className="estate-connection-content">
              {connection.lastErrorCode && (
                <p className="capability">Last error: {connection.lastErrorCode}</p>
              )}
              {scopeWorkspaces.length === 0 ? (
                <p className="muted">No workspaces discovered yet for this connection.</p>
              ) : (
                <EstateScopeTable
                  workspaces={scopeWorkspaces}
                  repositoriesByWorkspace={repositoriesByWorkspace}
                  onToggleWorkspace={toggleWorkspace}
                  onToggleRepo={toggleRepo}
                  pending={pending}
                />
              )}
              <GrowEstatePanel connection={connection} />
              <CredentialsPanel connectionId={connection.id} />
            </div>
          </details>
        );
      })}
    </>
  );
}

/**
 * Onboarding design Phase C2 — surfaces repositories discovered since the
 * operator last looked, across the whole estate (not per-connection: a
 * repository's provenance is already visible via its full name/workspace).
 * "Mark reviewed" advances the marker so this list is genuinely incremental
 * from here on, rather than a permanent everything-ever-discovered dump.
 */
function NewSinceReviewBanner() {
  const newRepos = useNewSinceReview();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function markReviewed() {
    setBusy(true);
    setError(null);
    try {
      await markEstateReviewed();
      await queryClient.invalidateQueries({ queryKey: ['estate-new-since-review'] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not mark the estate reviewed.');
    } finally {
      setBusy(false);
    }
  }

  if (!newRepos.data || newRepos.data.length === 0) return null;

  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <h2>
        {newRepos.data.length} repositor{newRepos.data.length === 1 ? 'y' : 'ies'} new since your
        last review
      </h2>
      {error && <div className="error-box">{error}</div>}
      <table className="data">
        <tbody>
          {newRepos.data.map((r) => (
            <tr key={r.id}>
              <td className="mono">{r.fullName}</td>
              <td className="muted">{r.provider}</td>
              <td>
                <span className={`badge ${r.monitoringState === 'ignored' ? 'outline' : 'info'}`}>
                  {r.monitoringState === 'ignored' ? 'not monitored' : 'monitored'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={markReviewed} disabled={busy} style={{ marginTop: 8 }}>
        {busy ? 'Marking reviewed…' : 'Mark all reviewed'}
      </button>
    </div>
  );
}

/**
 * Onboarding design "grow the estate" — for an existing connection, re-list
 * what its credentials can now see and let the operator add anything newly
 * visible. GitHub already discovers every installation on every call to
 * `GET /connections/:id/workspaces` (upserting new ones as monitored), so
 * "check" is enough; GitLab requires the same explicit group search + add
 * flow as the wizard's connect step, since it has no installation concept.
 */
function GrowEstatePanel({ connection }: { connection: ConnectionDto }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function afterGrowth() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['workspaces'] }),
      queryClient.invalidateQueries({ queryKey: ['estate-repositories'] }),
      queryClient.invalidateQueries({ queryKey: ['overview'] }),
    ]);
    try {
      await triggerManualSync();
    } catch {
      // Growth still succeeded — the scheduled pass will pick up the rest.
    }
  }

  async function checkForNewGitHubOrgs() {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const found = await discoverConnectionWorkspaces(connection.id);
      await afterGrowth();
      setStatus(
        found.length > 0
          ? `${found.length} organization(s) visible to this App — a sync is starting now.`
          : 'No organizations found. Install the app on an organization first.',
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not check for new organizations.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <details style={{ marginTop: 12 }}>
      <summary>Add more organizations / groups</summary>
      {error && <div className="error-box">{error}</div>}
      {status && <p className="muted">{status}</p>}

      {connection.provider === 'github' && (
        <div style={{ marginTop: 8 }}>
          {connection.installUrl ? (
            <a href={connection.installUrl} target="_blank" rel="noreferrer">
              <button className="ghost">Install on another organization ↗</button>
            </a>
          ) : (
            <p className="muted">
              Open this GitHub App under the target account or organization's settings and
              install it there.
            </p>
          )}
          <button onClick={checkForNewGitHubOrgs} disabled={busy} style={{ marginLeft: 8 }}>
            {busy ? 'Checking…' : 'Check for new organizations'}
          </button>
        </div>
      )}

      {connection.provider === 'gitlab' && <GrowGitLabGroups connectionId={connection.id} onGrown={afterGrowth} />}
    </details>
  );
}

function GrowGitLabGroups({
  connectionId,
  onGrown,
}: {
  connectionId: string;
  onGrown: () => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ externalId: string; fullPath: string; name: string; projectCount?: number }[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  async function search() {
    if (!query.trim()) return;
    setSearching(true);
    setError(null);
    try {
      setResults(await searchGitLabGroups(connectionId, query.trim()));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'GitLab group search failed.');
    } finally {
      setSearching(false);
    }
  }

  function toggle(fullPath: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(fullPath)) next.delete(fullPath);
      else next.add(fullPath);
      return next;
    });
  }

  async function addSelected() {
    if (selected.size === 0) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const created = await createGitLabWorkspaces(connectionId, [...selected]);
      await onGrown();
      setStatus(`Added ${created.length} group(s) — a sync is starting now.`);
      setSelected(new Set());
      setResults([]);
      setQuery('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add the selected groups.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 8 }}>
      {error && <div className="error-box">{error}</div>}
      {status && <p className="muted">{status}</p>}
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
          <input type="checkbox" checked={selected.has(g.fullPath)} onChange={() => toggle(g.fullPath)} />
          {g.name} <span className="muted">({g.fullPath}{g.projectCount !== undefined ? ` · ${g.projectCount} projects` : ''})</span>
        </label>
      ))}
      {results.length > 0 && (
        <button onClick={addSelected} disabled={busy || selected.size === 0} style={{ marginTop: 8 }}>
          {busy ? 'Adding…' : `Add ${selected.size || ''} group${selected.size === 1 ? '' : 's'}`}
        </button>
      )}
    </div>
  );
}

function CredentialsPanel({ connectionId }: { connectionId: string }) {
  const credentials = useConnectionCredentials(connectionId);
  const queryClient = useQueryClient();
  const [rotateName, setRotateName] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function rotate() {
    if (!rotateName || !value.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await rotateConnectionCredential(connectionId, rotateName, value.trim());
      setRotateName(null);
      setValue('');
      await queryClient.invalidateQueries({ queryKey: ['connection-credentials', connectionId] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not rotate the credential.');
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!window.confirm('Disconnect this connection and delete its stored credentials? This cannot be undone.')) {
      return;
    }
    setBusy(true);
    try {
      await disconnectConnection(connectionId);
      await queryClient.invalidateQueries({ queryKey: ['connections'] });
    } finally {
      setBusy(false);
    }
  }

  if (!credentials.data || credentials.data.length === 0) return null;

  return (
    <details style={{ marginTop: 12 }}>
      <summary>Credentials</summary>
      <table className="data" style={{ marginTop: 8 }}>
        <tbody>
          {credentials.data.map((cred) => (
            <tr key={cred.name}>
              <td className="mono">{cred.name}</td>
              <td className="mono">{cred.hint ?? '••••'}</td>
              <td className="muted">{cred.updatedAt ? `updated ${cred.updatedAt}` : ''}</td>
              <td>
                <button className="ghost" onClick={() => setRotateName(cred.name)}>
                  Replace
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rotateName && (
        <div style={{ marginTop: 8 }}>
          <label className="field mono-field">
            New value for {rotateName}
            <input type="password" value={value} onChange={(e) => setValue(e.target.value)} />
          </label>
          <div className="form-actions">
            <button onClick={rotate} disabled={busy || !value.trim()}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button className="ghost" onClick={() => setRotateName(null)} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && <div className="error-box">{error}</div>}
      <button className="ghost" onClick={disconnect} disabled={busy} style={{ marginTop: 8 }}>
        {busy ? 'Disconnecting…' : 'Disconnect'}
      </button>
    </details>
  );
}
