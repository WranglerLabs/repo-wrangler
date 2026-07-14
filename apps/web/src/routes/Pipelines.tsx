import { Link } from 'react-router-dom';
import { useEstatePipelines } from '../api/client';
import { formatDuration, timeAgo } from '../lib/format';
import { useVirtualWindow } from '../lib/useVirtualWindow';
import { ROW_HEIGHT, VIEWPORT_HEIGHT, VIRTUALIZE_ABOVE } from '../lib/listViewport';

function conclusionBadge(status: string, conclusion?: string): string {
  if (conclusion === 'failure' || conclusion === 'timed_out') return 'critical';
  if (conclusion === 'cancelled') return 'medium';
  if (conclusion === 'success') return 'healthy';
  if (status === 'in_progress' || status === 'queued') return 'info';
  return 'unknown';
}

export function Pipelines() {
  const pipelines = useEstatePipelines();
  const items = pipelines.data ?? [];
  const virtualize = items.length > VIRTUALIZE_ABOVE;
  const win = useVirtualWindow(items.length, ROW_HEIGHT, VIEWPORT_HEIGHT);
  const visible = virtualize ? items.slice(win.start, win.end) : items;

  return (
    <>
      <h1 className="page-title">Pipelines</h1>
      <p className="page-subtitle">
        Latest workflow and pipeline state per repository, failures first.
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
              <th>Workflow</th>
              <th>Status</th>
              <th>Branch</th>
              <th>Started</th>
              <th>Duration</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {pipelines.isLoading && (
              <tr>
                <td colSpan={7} className="muted">
                  Loading…
                </td>
              </tr>
            )}
            {items.length === 0 && !pipelines.isLoading && (
              <tr>
                <td colSpan={7} className="muted">
                  No pipeline runs observed yet.
                </td>
              </tr>
            )}
            {virtualize && win.padTop > 0 && (
              <tr aria-hidden>
                <td colSpan={7} style={{ height: win.padTop, padding: 0, border: 'none' }} />
              </tr>
            )}
            {visible.map((run, index) => (
              <tr key={`${run.repositoryId}-${win.start + index}`}>
                <td>
                  <Link to={`/repositories/${run.repositoryId}`}>{run.repositoryFullName}</Link>
                  <span className="badge outline" style={{ marginLeft: 6 }}>
                    {run.provider}
                  </span>
                </td>
                <td>{run.name ?? '—'}</td>
                <td>
                  <span className={`badge ${conclusionBadge(run.status, run.conclusion)}`}>
                    {run.conclusion ?? run.status}
                  </span>
                </td>
                <td className="mono">{run.branch ?? '—'}</td>
                <td>{timeAgo(run.runStartedAt)}</td>
                <td>{formatDuration(run.durationSeconds)}</td>
                <td>
                  {run.url && (
                    <a href={run.url} target="_blank" rel="noreferrer">
                      View run ↗
                    </a>
                  )}
                </td>
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
