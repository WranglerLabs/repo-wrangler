import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useRepositories } from '../api/client';
import { AttentionBadge, BranchStatusBadge, RunBadge } from '../components/Badges';
import { timeAgo } from '../lib/format';

const LEVELS = ['all', 'critical', 'high', 'medium', 'low', 'healthy', 'unknown'] as const;

export function Repositories() {
  const [includeArchived, setIncludeArchived] = useState(false);
  const [search, setSearch] = useState('');
  const [level, setLevel] = useState<(typeof LEVELS)[number]>('all');
  const repositories = useRepositories(includeArchived);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (repositories.data ?? []).filter((repo) => {
      if (level !== 'all' && repo.attentionLevel !== level) return false;
      if (term && !repo.fullName.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [repositories.data, search, level]);

  function exportJson() {
    const blob = new Blob([JSON.stringify(filtered, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'repo-wrangler-inventory.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <h1 className="page-title">Repositories</h1>
      <p className="page-subtitle">
        {repositories.data ? `${filtered.length} of ${repositories.data.length} repositories` : ' '}
      </p>

      <div className="toolbar">
        <input
          type="search"
          placeholder="Filter by name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={level} onChange={(e) => setLevel(e.target.value as (typeof LEVELS)[number])}>
          {LEVELS.map((l) => (
            <option key={l} value={l}>
              {l === 'all' ? 'All attention levels' : l}
            </option>
          ))}
        </select>
        <label className="muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />
          Include archived
        </label>
        <button className="ghost" onClick={exportJson} style={{ marginLeft: 'auto' }}>
          Export JSON
        </button>
      </div>

      <div className="panel table-scroll">
        <table className="data">
          <thead>
            <tr>
              <th>Repository</th>
              <th>Attention</th>
              <th>Default branch</th>
              <th>Branch state</th>
              <th>Pipeline</th>
              <th>PRs</th>
              <th>Last activity</th>
              <th>Synced</th>
            </tr>
          </thead>
          <tbody>
            {repositories.isLoading && (
              <tr>
                <td colSpan={8} className="muted">
                  Loading…
                </td>
              </tr>
            )}
            {filtered.map((repo) => (
              <tr key={repo.id}>
                <td>
                  <Link to={`/repositories/${repo.id}`}>{repo.fullName}</Link>
                  {repo.status === 'inaccessible' && (
                    <span className="badge outline" style={{ marginLeft: 6 }}>
                      inaccessible
                    </span>
                  )}
                  {repo.isArchived && (
                    <span className="badge outline" style={{ marginLeft: 6 }}>
                      archived
                    </span>
                  )}
                  <div className="muted">{repo.primaryLanguage ?? ''}</div>
                </td>
                <td>
                  <AttentionBadge level={repo.attentionLevel} />
                </td>
                <td className="mono">{repo.defaultBranch ?? '—'}</td>
                <td>
                  <BranchStatusBadge status={repo.defaultBranchStatus} />
                  {repo.branchesAhead > 0 && (
                    <div className="muted">{repo.branchesAhead} ahead</div>
                  )}
                </td>
                <td>
                  <RunBadge conclusion={repo.latestRunConclusion} at={repo.latestRunAt} />
                </td>
                <td>{repo.openChangeRequests}</td>
                <td>{timeAgo(repo.pushedAt)}</td>
                <td className="muted">{timeAgo(repo.lastSyncedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
