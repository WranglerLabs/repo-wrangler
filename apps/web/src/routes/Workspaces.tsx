import { useEffect, useMemo, useState } from 'react';
import { useWorkspaces } from '../api/client';
import { AttentionBadge } from '../components/Badges';
import { timeAgo } from '../lib/format';
import {
  applyWorkspaceView,
  type WorkspaceSort,
  type WorkspaceSortDirection,
} from '../lib/workspaceView';

const ATTENTION_LEVELS = ['all', 'critical', 'high', 'medium', 'low', 'healthy', 'unknown'] as const;

export function Workspaces() {
  const workspaces = useWorkspaces();
  const [search, setSearch] = useState('');
  const [provider, setProvider] = useState('all');
  const [kind, setKind] = useState('all');
  const [attention, setAttention] = useState('all');
  const [monitoringState, setMonitoringState] = useState('all');
  const [sort, setSort] = useState<WorkspaceSort>('name');
  const [direction, setDirection] = useState<WorkspaceSortDirection>('asc');
  const [pageSize, setPageSize] = useState(25);
  const [requestedPage, setRequestedPage] = useState(1);

  const options = useMemo(() => {
    const data = workspaces.data ?? [];
    const unique = (values: string[]) => [...new Set(values)].sort();
    return {
      providers: unique(data.map((workspace) => workspace.provider)),
      kinds: unique(data.map((workspace) => workspace.kind)),
    };
  }, [workspaces.data]);

  const filtered = useMemo(
    () => applyWorkspaceView(workspaces.data ?? [], {
      search, provider, kind, attention, monitoringState, sort, direction,
    }),
    [workspaces.data, search, provider, kind, attention, monitoringState, sort, direction],
  );

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(requestedPage, pageCount);
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => setRequestedPage(1), [search, provider, kind, attention, monitoringState, sort, direction, pageSize]);

  function resetView() {
    setSearch('');
    setProvider('all');
    setKind('all');
    setAttention('all');
    setMonitoringState('all');
    setSort('name');
    setDirection('asc');
    setPageSize(25);
  }

  return (
    <>
      <h1 className="page-title">Workspaces</h1>
      <p className="page-subtitle">
        {workspaces.data
          ? `${filtered.length} of ${workspaces.data.length} GitHub organizations, accounts, and GitLab groups`
          : 'GitHub organizations and accounts, and GitLab groups.'}
      </p>

      <div className="toolbar">
        <input type="search" aria-label="Search workspaces" placeholder="Search workspaces…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select aria-label="Filter by provider" value={provider} onChange={(e) => setProvider(e.target.value)}>
          <option value="all">All providers</option>
          {options.providers.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <select aria-label="Filter by workspace kind" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="all">All kinds</option>
          {options.kinds.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <select aria-label="Filter by attention level" value={attention} onChange={(e) => setAttention(e.target.value)}>
          {ATTENTION_LEVELS.map((value) => <option key={value} value={value}>{value === 'all' ? 'All attention levels' : `Has ${value}`}</option>)}
        </select>
        <select aria-label="Filter by monitoring state" value={monitoringState} onChange={(e) => setMonitoringState(e.target.value)}>
          <option value="all">All monitoring states</option>
          <option value="monitored">Monitored</option>
          <option value="ignored">Ignored</option>
        </select>
        <select aria-label="Sort workspaces" value={sort} onChange={(e) => setSort(e.target.value as WorkspaceSort)}>
          <option value="name">Sort: name</option>
          <option value="repositories">Sort: repositories</option>
          <option value="attention">Sort: attention</option>
          <option value="reconciled">Sort: last reconciled</option>
          <option value="provider">Sort: provider</option>
        </select>
        <select aria-label="Sort direction" value={direction} onChange={(e) => setDirection(e.target.value as WorkspaceSortDirection)}>
          <option value="asc">Ascending</option>
          <option value="desc">Descending</option>
        </select>
        <button className="ghost" onClick={resetView}>Reset</button>
      </div>

      <div className="panel table-scroll">
        <table className="data">
          <thead>
            <tr><th>Workspace</th><th>Kind</th><th>Repositories</th><th>Attention</th><th>Last reconciled</th></tr>
          </thead>
          <tbody>
            {workspaces.isLoading && <tr><td colSpan={5} className="muted">Loading…</td></tr>}
            {!workspaces.isLoading && visible.length === 0 && <tr><td colSpan={5} className="muted">No workspaces match these filters.</td></tr>}
            {visible.map((workspace) => (
              <tr key={workspace.id}>
                <td>
                  <strong>{workspace.displayName ?? workspace.slug}</strong>
                  <div className="muted">{workspace.provider} · {workspace.slug}</div>
                </td>
                <td>{workspace.kind}</td>
                <td>{workspace.repositoryCount}</td>
                <td>
                  {Object.entries(workspace.attentionCounts).filter(([level]) => level !== 'healthy').map(([level, count]) => (
                    <span key={level} style={{ marginRight: 6 }}><AttentionBadge level={level} /> {count}</span>
                  ))}
                </td>
                <td>{timeAgo(workspace.lastReconciledAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <nav className="pagination" aria-label="Workspace pages">
        <label className="muted">Rows per page{' '}
          <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
            {[25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
        <button className="ghost" disabled={page === 1} onClick={() => setRequestedPage(page - 1)}>Previous</button>
        <span className="muted">Page {page} of {pageCount}</span>
        <button className="ghost" disabled={page === pageCount} onClick={() => setRequestedPage(page + 1)}>Next</button>
      </nav>
    </>
  );
}

