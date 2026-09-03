import { Link } from 'react-router-dom';
import { useConnections } from '../api/client';

export function Connections() {
  const connections = useConnections(true, true);
  return <>
    <h1 className="page-title">Connections</h1>
    <p className="page-subtitle">Provider identities, credential ownership, accessible scope, health, and synchronization.</p>
    <p><Link className="button-link" to="/onboarding?add=1">Add connection</Link></p>
    <div className="panel table-scroll"><table className="data"><thead><tr>
      <th>Provider / name</th><th>Account or base URL</th><th>Credentials</th><th>Status</th>
      <th>Permissions / capability</th><th>Scope</th><th>Last discovery</th><th>Last billing</th><th>Last error</th><th>Work</th>
    </tr></thead><tbody>{connections.data?.map((connection) => <tr key={connection.id}>
      <td><Link to={`/admin/connections/${connection.id}`}>{connection.provider} — {connection.displayName}</Link></td>
      <td>{connection.providerAccount ?? connection.baseUrl ?? '—'}</td>
      <td>{connection.credentialSource} · {connection.authenticationType}</td><td>{connection.status}</td>
      <td>{connection.capabilityStatus ?? 'Not checked'}</td>
      <td>{connection.workspaceCount} organizations/groups · {connection.repositoryCount} repositories</td>
      <td>{connection.lastDiscoveryAt ?? 'Never'}</td><td>{connection.lastBillingAt ?? 'Never'}</td>
      <td>{connection.lastErrorCode ?? '—'}</td><td>{connection.pendingWork ? `${connection.pendingWork} pending/running` : 'Idle'}</td>
    </tr>)}</tbody></table></div>
  </>;
}
