import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { GitLabGroupSearchResultDto } from '@repo-wrangler/contracts';
import {
  ApiError,
  changeConnectionStatus,
  createGitLabWorkspaces,
  detachGitLabWorkspace,
  disconnectConnection,
  discoverConnectionWorkspaces,
  reconcileConnection,
  rotateConnectionCredential,
  searchGitLabGroups,
  setRepositoryMonitoringState,
  setWorkspaceMonitoringState,
  useConnectionCredentials,
  useConnectionRepositories,
  useConnections,
  useConnectionWorkspaces,
} from '../api/client';

export function ConnectionDetail() {
  const { id } = useParams();
  const queryClient = useQueryClient();
  const connections = useConnections(true, true);
  const connection = connections.data?.find((item) => item.id === id);
  const workspaces = useConnectionWorkspaces(id, { refreshProvider: false });
  const repositories = useConnectionRepositories(id);
  const credentials = useConnectionCredentials(id);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [replacement, setReplacement] = useState<{ name: string; value: string } | null>(null);
  const [groupQuery, setGroupQuery] = useState('');
  const [groupResults, setGroupResults] = useState<GitLabGroupSearchResultDto[]>([]);
  const [busy, setBusy] = useState(false);

  if (!id) return <p>Connection not found.</p>;
  if (!connection) return <p>{connections.isLoading ? 'Loading connection…' : 'Connection not found.'}</p>;
  const optionalCredentialNames = connection.provider === 'github'
    ? ['GITHUB_WEBHOOK_SECRET', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET']
    : ['GITLAB_WEBHOOK_SECRET'];
  const existingCredentialNames = new Set(credentials.data?.map((credential) => credential.name) ?? []);

  async function refreshAll() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['connections'] }),
      workspaces.refetch(),
      repositories.refetch(),
    ]);
  }

  async function runAction(action: () => Promise<void>, success: string) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
      setMessage(success);
      await refreshAll();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'The operation failed.');
    } finally {
      setBusy(false);
    }
  }

  async function findGroups() {
    if (!groupQuery.trim()) return;
    setBusy(true);
    setError('');
    try {
      setGroupResults(await searchGitLabGroups(id!, groupQuery.trim()));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'GitLab group search failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p><Link to="/admin/connections">← Connections</Link></p>
      <h1 className="page-title">{connection.displayName}</h1>
      <p className="page-subtitle">
        {connection.provider} · {connection.providerAccount ?? connection.baseUrl ?? 'provider account unavailable'}
      </p>
      {error && <div className="error-box">{error}</div>}
      {message && <div className="panel"><p>{message}</p></div>}

      <div className="panel">
        <h2>Health and control</h2>
        <p>
          Status: <strong>{connection.status}</strong> · Capability: <strong>{connection.capabilityStatus ?? 'not checked'}</strong>
          {' '}· {connection.workspaceCount} organizations/groups · {connection.repositoryCount} repositories
        </p>
        <p>
          Last discovery: {connection.lastDiscoveryAt ?? 'Never'} · Last billing: {connection.lastBillingAt ?? 'Never'}
          {' '}· Last error: {connection.lastErrorCode ?? 'None'} · Pending/running work: {connection.pendingWork}
        </p>
        {connection.permissionDetails && (
          <p>
            Provider permissions: {Object.entries(connection.permissionDetails)
              .map(([name, level]) => `${name}: ${level}`).join(', ')}
          </p>
        )}
        {connection.capabilityStatus === 'write_scope_detected' && (
          <div className="error-box">This connection reports write-level permissions. RepoWrangler only requires read access; review the provider configuration.</div>
        )}
        <button
          onClick={() => runAction(
            () => reconcileConnection(id),
            'Reconciliation was enqueued. Follow its started/completed state in Operations.',
          )}
          disabled={busy || connection.status !== 'active'}
        >Refresh / reconcile now</button>{' '}
        {connection.status !== 'removed' && <>
          <button
            className="ghost"
            disabled={busy}
            onClick={() => runAction(
              () => changeConnectionStatus(id, connection.status === 'active' ? 'disabled' : 'active'),
              `Connection ${connection.status === 'active' ? 'disabled' : 'enabled'}.`,
            )}
          >{connection.status === 'active' ? 'Disable' : 'Enable'}</button>{' '}
          <button
            className="ghost"
            disabled={busy}
            onClick={() => {
              const environmentNote = connection.credentialSource === 'environment'
                ? ' The deployment-provided secret will remain outside RepoWrangler.' : '';
              if (!window.confirm(`Disconnect this connection? Historical inventory remains.${environmentNote}`)) return;
              void runAction(() => disconnectConnection(id), 'Connection disconnected; historical records were retained.');
            }}
          >Disconnect</button>{' '}
        </>}
        <Link to="/admin/operations">View Operations</Link>
      </div>

      <div className="panel">
        <h2>Organizations and groups</h2>
        {connection.provider === 'github' && connection.status !== 'removed' && (
          <p>
            {connection.installUrl
              ? <a href={connection.installUrl} target="_blank" rel="noreferrer">Install this App on another organization ↗</a>
              : 'Install the GitHub App from its provider settings to add another organization.'}{' '}
            <button
              className="ghost"
              disabled={busy}
              onClick={() => runAction(
                async () => { await discoverConnectionWorkspaces(id); },
                'Visible GitHub installations refreshed. Run reconciliation to scan repositories.',
              )}
            >Refresh visible organizations</button>
          </p>
        )}
        {connection.provider === 'gitlab' && connection.status !== 'removed' && (
          <div>
            <div className="toolbar">
              <input
                type="search"
                value={groupQuery}
                placeholder="Search accessible GitLab groups…"
                onChange={(event) => setGroupQuery(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') void findGroups(); }}
              />
              <button onClick={findGroups} disabled={busy || !groupQuery.trim()}>Search</button>
            </div>
            {groupResults.map((group) => (
              <p key={group.externalId}>
                <span className="mono">{group.fullPath}</span>
                {group.projectCount === undefined ? '' : ` · ${group.projectCount} projects`}{' '}
                <button
                  className="ghost"
                  disabled={busy}
                  onClick={() => runAction(
                    async () => { await createGitLabWorkspaces(id, [group.fullPath]); setGroupResults([]); },
                    `${group.fullPath} added to discovery.`,
                  )}
                >Add group</button>
              </p>
            ))}
          </div>
        )}
        <table className="data">
          <thead><tr><th>Workspace</th><th>Kind</th><th>State</th><th>Repositories</th><th>Actions</th></tr></thead>
          <tbody>
            {workspaces.data?.map((workspace) => (
              <tr key={workspace.id}>
                <td>{workspace.slug}</td>
                <td>{workspace.kind}</td>
                <td>{workspace.status}{workspace.statusReason ? ` · ${workspace.statusReason}` : ''}</td>
                <td>{workspace.repoCount ?? 'Unavailable'}</td>
                <td>
                  {workspace.status === 'active' && (
                    <button
                      className="ghost"
                      disabled={busy}
                      onClick={() => runAction(
                        () => setWorkspaceMonitoringState(
                          workspace.id,
                          workspace.monitoringState === 'monitored' ? 'ignored' : 'monitored',
                        ),
                        'Monitoring scope updated.',
                      )}
                    >{workspace.monitoringState === 'monitored' ? 'Ignore' : 'Monitor'}</button>
                  )}{' '}
                  {connection.provider === 'gitlab' && workspace.statusReason !== 'detached_by_operator' && (
                    <button
                      className="ghost"
                      disabled={busy}
                      onClick={() => {
                        if (!window.confirm(`Detach ${workspace.slug} from this connection's discovery scope?`)) return;
                        void runAction(
                          () => detachGitLabWorkspace(id, workspace.id),
                          `${workspace.slug} detached from discovery; history remains.`,
                        );
                      }}
                    >Detach</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <h2>Repository inventory</h2>
        <p className="muted">Active, inaccessible, moved, merged, and removed records remain reviewable here.</p>
        <table className="data">
          <thead><tr><th>Repository</th><th>Workspace</th><th>State</th><th>Last seen</th><th>Monitoring</th></tr></thead>
          <tbody>
            {repositories.data?.map((repository) => (
              <tr key={repository.id}>
                <td className="mono">{repository.fullName}</td>
                <td>{repository.workspaceSlug}</td>
                <td>{repository.status}{repository.statusReason ? ` · ${repository.statusReason}` : ''}</td>
                <td>{repository.lastSeenAt}</td>
                <td>
                  {repository.status === 'active' ? (
                    <button
                      className="ghost"
                      disabled={busy}
                      onClick={() => runAction(
                        () => setRepositoryMonitoringState(
                          repository.id,
                          repository.monitoringState === 'monitored' ? 'ignored' : 'monitored',
                        ),
                        'Repository monitoring updated.',
                      )}
                    >{repository.monitoringState === 'monitored' ? 'Ignore' : 'Monitor'}</button>
                  ) : repository.monitoringState}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <h2>Credentials</h2>
        <p>
          Source: <strong>{connection.credentialSource}</strong>.{' '}
          {connection.credentialSource === 'environment'
            ? 'This credential comes from deployment configuration. RepoWrangler can disable or disconnect the connection, but cannot rotate or delete that external secret.'
            : 'Encrypted application-managed credentials can be rotated below.'}
        </p>
        {connection.status !== 'removed' && connection.credentialSource === 'database' && credentials.data?.map((credential) => (
          <div key={credential.name}>
            <span className="mono">{credential.name}</span> {credential.hint ?? '••••'}{' '}
            <button className="ghost" onClick={() => setReplacement({ name: credential.name, value: '' })}>Replace</button>
          </div>
        ))}
        {connection.status !== 'removed' && connection.credentialSource === 'database' && optionalCredentialNames
          .filter((name) => !existingCredentialNames.has(name))
          .map((name) => (
            <div key={name}>
              <span className="mono">{name}</span> not configured{' '}
              <button className="ghost" onClick={() => setReplacement({ name, value: '' })}>Add</button>
            </div>
          ))}
        {replacement && (
          <div className="form-actions">
            <input
              type="password"
              value={replacement.value}
              onChange={(event) => setReplacement({ ...replacement, value: event.target.value })}
              placeholder={`New ${replacement.name}`}
            />
            <button
              disabled={busy || !replacement.value}
              onClick={() => runAction(
                async () => {
                  await rotateConnectionCredential(id, replacement.name, replacement.value);
                  setReplacement(null);
                  await credentials.refetch();
                },
                'Credential rotated.',
              )}
            >Save</button>
            <button className="ghost" onClick={() => setReplacement(null)}>Cancel</button>
          </div>
        )}
      </div>
    </>
  );
}
