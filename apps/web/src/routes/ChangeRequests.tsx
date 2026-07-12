import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useEstateChangeRequests } from '../api/client';
import { timeAgo } from '../lib/format';

const FILTERS = ['all', 'blocked', 'stale', 'ready', 'draft'] as const;

const ATTENTION_BADGE: Record<string, string> = {
  blocked: 'high',
  stale: 'medium',
  ready: 'healthy',
  draft: 'unknown',
  normal: 'info',
};

export function ChangeRequests() {
  const changeRequests = useEstateChangeRequests();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all');

  const filtered = useMemo(
    () =>
      (changeRequests.data ?? []).filter(
        (cr) => filter === 'all' || cr.attention === filter,
      ),
    [changeRequests.data, filter],
  );

  return (
    <>
      <h1 className="page-title">Change Requests</h1>
      <p className="page-subtitle">Open pull requests and merge requests across the estate.</p>

      <div className="toolbar">
        {FILTERS.map((f) => (
          <button
            key={f}
            className={filter === f ? '' : 'ghost'}
            onClick={() => setFilter(f)}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="panel table-scroll">
        <table className="data">
          <thead>
            <tr>
              <th>Repository</th>
              <th>#</th>
              <th>Title</th>
              <th>Author</th>
              <th>Attention</th>
              <th>Base ← Head</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {changeRequests.isLoading && (
              <tr>
                <td colSpan={7} className="muted">
                  Loading…
                </td>
              </tr>
            )}
            {filtered.length === 0 && !changeRequests.isLoading && (
              <tr>
                <td colSpan={7} className="muted">
                  No open change requests match this filter.
                </td>
              </tr>
            )}
            {filtered.map((cr) => (
              <tr key={`${cr.repositoryId}-${cr.number}`}>
                <td>
                  <Link to={`/repositories/${cr.repositoryId}`}>{cr.repositoryFullName}</Link>
                  <span className="badge outline" style={{ marginLeft: 6 }}>
                    {cr.provider}
                  </span>
                </td>
                <td>
                  {cr.url ? (
                    <a href={cr.url} target="_blank" rel="noreferrer">
                      #{cr.number}
                    </a>
                  ) : (
                    `#${cr.number}`
                  )}
                </td>
                <td>{cr.title}</td>
                <td>{cr.author ?? '—'}</td>
                <td>
                  <span className={`badge ${ATTENTION_BADGE[cr.attention] ?? 'info'}`}>
                    {cr.attention}
                  </span>
                </td>
                <td className="mono">
                  {cr.baseRef} ← {cr.headRef}
                </td>
                <td>{timeAgo(cr.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
