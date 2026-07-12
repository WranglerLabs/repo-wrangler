import { useWorkspaces } from '../api/client';
import { AttentionBadge } from '../components/Badges';
import { timeAgo } from '../lib/format';

export function Workspaces() {
  const workspaces = useWorkspaces();

  return (
    <>
      <h1 className="page-title">Workspaces</h1>
      <p className="page-subtitle">GitHub organizations and accounts (GitLab groups later).</p>

      <div className="panel table-scroll">
        <table className="data">
          <thead>
            <tr>
              <th>Workspace</th>
              <th>Kind</th>
              <th>Repositories</th>
              <th>Attention</th>
              <th>Last reconciled</th>
            </tr>
          </thead>
          <tbody>
            {workspaces.isLoading && (
              <tr>
                <td colSpan={5} className="muted">
                  Loading…
                </td>
              </tr>
            )}
            {workspaces.data?.map((workspace) => (
              <tr key={workspace.id}>
                <td>
                  <strong>{workspace.displayName ?? workspace.slug}</strong>
                  <div className="muted">{workspace.slug}</div>
                </td>
                <td>{workspace.kind}</td>
                <td>{workspace.repositoryCount}</td>
                <td>
                  {Object.entries(workspace.attentionCounts)
                    .filter(([level]) => level !== 'healthy')
                    .map(([level, count]) => (
                      <span key={level} style={{ marginRight: 6 }}>
                        <AttentionBadge level={level} /> {count}
                      </span>
                    ))}
                </td>
                <td>{timeAgo(workspace.lastReconciledAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
