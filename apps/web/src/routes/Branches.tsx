import { Link } from 'react-router-dom';
import { useEstateBranches } from '../api/client';
import { timeAgo } from '../lib/format';
import { useVirtualWindow } from '../lib/useVirtualWindow';
import { ROW_HEIGHT, VIEWPORT_HEIGHT, VIRTUALIZE_ABOVE } from '../lib/listViewport';

export function Branches() {
  const branches = useEstateBranches();
  const items = branches.data ?? [];
  const virtualize = items.length > VIRTUALIZE_ABOVE;
  const win = useVirtualWindow(items.length, ROW_HEIGHT, VIEWPORT_HEIGHT);
  const visible = virtualize ? items.slice(win.start, win.end) : items;

  return (
    <>
      <h1 className="page-title">Branches</h1>
      <p className="page-subtitle">
        Every active branch ahead of or diverged from its default branch, estate-wide.
      </p>

      <div
        className="panel table-scroll"
        style={virtualize ? { maxHeight: VIEWPORT_HEIGHT, overflowY: 'auto' } : undefined}
        onScroll={virtualize ? win.onScroll : undefined}
      >
        <table className="data">
          <thead>
            <tr>
              <th>Repository</th>
              <th>Branch</th>
              <th>State</th>
              <th>Ahead</th>
              <th>Behind</th>
              <th>PR/MR</th>
              <th>Head age</th>
            </tr>
          </thead>
          <tbody>
            {branches.isLoading && (
              <tr>
                <td colSpan={7} className="muted">
                  Loading…
                </td>
              </tr>
            )}
            {items.length === 0 && !branches.isLoading && (
              <tr>
                <td colSpan={7} className="muted">
                  No branches are ahead of their default branch. Everything is merged.
                </td>
              </tr>
            )}
            {virtualize && win.padTop > 0 && (
              <tr aria-hidden>
                <td colSpan={7} style={{ height: win.padTop, padding: 0, border: 'none' }} />
              </tr>
            )}
            {visible.map((branch) => (
              <tr key={`${branch.repositoryId}-${branch.name}`}>
                <td>
                  <Link to={`/repositories/${branch.repositoryId}`}>
                    {branch.repositoryFullName}
                  </Link>
                  <span className="badge outline" style={{ marginLeft: 6 }}>
                    {branch.provider}
                  </span>
                </td>
                <td className="mono">{branch.name}</td>
                <td>
                  <span className={`badge ${branch.comparisonStatus === 'diverged' ? 'high' : 'medium'}`}>
                    {branch.comparisonStatus}
                  </span>
                </td>
                <td>{branch.aheadBy ?? '—'}</td>
                <td>{branch.behindBy ?? '—'}</td>
                <td>
                  {branch.openChangeRequestNumber ? (
                    `#${branch.openChangeRequestNumber}`
                  ) : (
                    <span className="badge medium">untracked</span>
                  )}
                </td>
                <td>{timeAgo(branch.headCommittedAt)}</td>
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
