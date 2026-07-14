import { useActivity } from '../api/client';
import { timeAgo } from '../lib/format';
import { useVirtualWindow } from '../lib/useVirtualWindow';
import { ROW_HEIGHT, VIEWPORT_HEIGHT, VIRTUALIZE_ABOVE } from '../lib/listViewport';

function kindBadge(kind: string): string {
  if (kind === 'sync-failure') return 'high';
  if (kind === 'health') return 'medium';
  if (kind === 'admin') return 'info';
  if (kind === 'discovery') return 'healthy';
  return 'outline';
}

export function Activity() {
  const activity = useActivity();
  const items = activity.data ?? [];
  const virtualize = items.length > VIRTUALIZE_ABOVE;
  const win = useVirtualWindow(items.length, ROW_HEIGHT, VIEWPORT_HEIGHT);
  const visible = virtualize ? items.slice(win.start, win.end) : items;

  return (
    <>
      <h1 className="page-title">Activity</h1>
      <p className="page-subtitle">
        Recent synchronization runs, discoveries, health changes, and administrative actions.
      </p>

      <div
        className="panel table-scroll"
        style={virtualize ? { maxHeight: VIEWPORT_HEIGHT, overflowY: 'auto' } : undefined}
        onScroll={virtualize ? win.onScroll : undefined}
      >
        <table className="data">
          <thead>
            <tr>
              <th>When</th>
              <th>Kind</th>
              <th>Event</th>
              <th>Actor</th>
            </tr>
          </thead>
          <tbody>
            {activity.isLoading && (
              <tr>
                <td colSpan={4} className="muted">
                  Loading…
                </td>
              </tr>
            )}
            {items.length === 0 && !activity.isLoading && (
              <tr>
                <td colSpan={4} className="muted">
                  No activity recorded yet.
                </td>
              </tr>
            )}
            {virtualize && win.padTop > 0 && (
              <tr aria-hidden>
                <td colSpan={4} style={{ height: win.padTop, padding: 0, border: 'none' }} />
              </tr>
            )}
            {visible.map((event, index) => (
              <tr key={win.start + index}>
                <td>{timeAgo(event.at)}</td>
                <td>
                  <span className={`badge ${kindBadge(event.kind)}`}>{event.kind}</span>
                </td>
                <td>{event.message}</td>
                <td>{event.actor ?? '—'}</td>
              </tr>
            ))}
            {virtualize && win.padBottom > 0 && (
              <tr aria-hidden>
                <td colSpan={4} style={{ height: win.padBottom, padding: 0, border: 'none' }} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
