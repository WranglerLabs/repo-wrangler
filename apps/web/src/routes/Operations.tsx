import { retryOperation, useOperations } from '../api/client';

function duration(start?: string, finish?: string) {
  if (!start) return '—';
  const end = finish ? Date.parse(finish) : Date.now();
  return `${Math.max(0, Math.round((end - Date.parse(start)) / 1000))}s`;
}

export function Operations() {
  const operations = useOperations();
  return <>
    <h1 className="page-title">Operations</h1>
    <p className="page-subtitle">Queued, running, completed, and failed provider work. A pending job is not a completed synchronization.</p>
    <div className="panel table-scroll"><table className="data"><thead><tr>
      <th>Type / scope</th><th>State</th><th>Created</th><th>Started</th><th>Completed</th>
      <th>Duration</th><th>API requests</th><th>Checkpoint</th><th>Error</th><th></th>
    </tr></thead><tbody>{operations.data?.map((operation) => <tr key={operation.id}>
      <td>{operation.type}<br/><span className="muted mono">{operation.scope ?? 'all'} · {operation.correlationId}</span>
        {operation.resultSummary && <div className="muted">{Object.entries(operation.resultSummary).map(([key, value]) => `${key}: ${String(value)}`).join(' · ')}</div>}</td>
      <td>{operation.state}</td><td>{operation.createdAt}</td><td>{operation.startedAt ?? 'Not started'}</td>
      <td>{operation.finishedAt ?? 'Not completed'}</td><td>{duration(operation.startedAt, operation.finishedAt)}</td>
      <td>{operation.subrequestsUsed}</td><td className="mono">{operation.checkpoint ?? '—'}</td>
      <td>{operation.errorCode ? `${operation.errorCode}${operation.lastError ? ` · ${operation.lastError}` : ''}` : operation.lastError ?? '—'}</td><td>{operation.retryEligible && <button className="ghost" onClick={async () => { await retryOperation(operation.id); await operations.refetch(); }}>Retry</button>}</td>
    </tr>)}</tbody></table></div>
  </>;
}
