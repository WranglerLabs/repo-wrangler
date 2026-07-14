import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useEstateChangeRequests } from '../api/client';
import { timeAgo } from '../lib/format';
import { useVirtualWindow } from '../lib/useVirtualWindow';
import { ROW_HEIGHT, VIEWPORT_HEIGHT, VIRTUALIZE_ABOVE } from '../lib/listViewport';

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

  const virtualize = filtered.length > VIRTUALIZE_ABOVE;
  const win = useVirtualWindow(filtered.length, ROW_HEIGHT, VIEWPORT_HEIGHT);
  const visible = virtualize ? filtered.slice(win.start, win.end) : filtered;

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

      <div
        className="panel table-scroll"
        style={virtualize ? { maxHeight: VIEWPORT_HEIGHT, overflowY: 'auto' } : undefined}
        onScroll={virtualize ? win.onScroll : undefined}
      >
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
            {virtualize && win.padTop > 0 && (
              <tr aria-hidden>
                <td colSpan={7} style={{ height: win.padTop, padding: 0, border: 'none' }} />
              </tr>
            )}
            {visible.map((cr) => (
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
            {virtualize && win.padBottom > 0 && (
              <tr aria-hidden>
                <td colSpan={7} style={{ height: win.padBottom, padding: 0, border: 'none' }} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
