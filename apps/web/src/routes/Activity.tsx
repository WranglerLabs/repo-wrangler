import { useActivity } from '../api/client';
import { timeAgo } from '../lib/format';

function kindBadge(kind: string): string {
  if (kind === 'sync-failure') return 'high';
  if (kind === 'health') return 'medium';
  if (kind === 'admin') return 'info';
  if (kind === 'discovery') return 'healthy';
  return 'outline';
}

export function Activity() {
  const activity = useActivity();

  return (
    <>
      <h1 className="page-title">Activity</h1>
      <p className="page-subtitle">
        Recent synchronization runs, discoveries, health changes, and administrative actions.
      </p>

      <div className="panel table-scroll">
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
            {activity.data?.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  No activity recorded yet.
                </td>
              </tr>
            )}
            {activity.data?.map((event, index) => (
              <tr key={index}>
                <td>{timeAgo(event.at)}</td>
                <td>
                  <span className={`badge ${kindBadge(event.kind)}`}>{event.kind}</span>
                </td>
                <td>{event.message}</td>
                <td>{event.actor ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
