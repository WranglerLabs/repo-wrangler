import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  markEstateReviewed,
  setRepositoryMonitoringState,
  setWorkspaceMonitoringState,
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
      <div className="page-heading-row">
        <div>
          <h1 className="page-title">Estate scope</h1>
          <p className="page-subtitle">
            Choose which organizations, groups, and repositories RepoWrangler monitors — the same
            controls as the onboarding wizard, available any time.
          </p>
        </div>
        <Link className="button-link" to="/onboarding?add=1">Connect another platform</Link>
      </div>

      <NewSinceReviewBanner />

      {connections.data?.length === 0 && (
        <div className="panel">
          <p className="muted">No connections yet. Start with the onboarding wizard.</p>
          <Link className="button-link" to="/onboarding">Connect a platform</Link>
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
              <p style={{ marginTop: 12 }}>
                <Link to={`/admin/connections/${connection.id}`}>
                  Manage connection, credentials, and discovered resources
                </Link>
              </p>
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
