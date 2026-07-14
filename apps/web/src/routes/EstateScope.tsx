import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  disconnectConnection,
  rotateConnectionCredential,
  setRepositoryMonitoringState,
  setWorkspaceMonitoringState,
  useConnectionCredentials,
  useConnections,
  useEstateRepositories,
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
        <Link to="/onboarding">Connect another platform →</Link>
      </p>

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
          <div className="panel" key={connection.id}>
            <h2>
              {connection.provider === 'github' ? 'GitHub' : 'GitLab'} — {connection.displayName}
              <span className={`badge ${connection.status === 'active' ? 'info' : 'outline'}`} style={{ marginLeft: 8 }}>
                {connection.status}
              </span>
            </h2>
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
            <CredentialsPanel connectionId={connection.id} />
          </div>
        );
      })}
    </>
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
