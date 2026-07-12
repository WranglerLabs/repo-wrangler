import { Link } from 'react-router-dom';
import { useEstatePipelines } from '../api/client';
import { formatDuration, timeAgo } from '../lib/format';

function conclusionBadge(status: string, conclusion?: string): string {
  if (conclusion === 'failure' || conclusion === 'timed_out') return 'critical';
  if (conclusion === 'cancelled') return 'medium';
  if (conclusion === 'success') return 'healthy';
  if (status === 'in_progress' || status === 'queued') return 'info';
  return 'unknown';
}

export function Pipelines() {
  const pipelines = useEstatePipelines();

  return (
    <>
      <h1 className="page-title">Pipelines</h1>
      <p className="page-subtitle">
        Latest workflow and pipeline state per repository, failures first.
      </p>

      <div className="panel table-scroll">
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
            {pipelines.data?.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  No pipeline runs observed yet.
                </td>
              </tr>
            )}
            {pipelines.data?.map((run, index) => (
              <tr key={`${run.repositoryId}-${index}`}>
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
          </tbody>
        </table>
      </div>
    </>
  );
}
