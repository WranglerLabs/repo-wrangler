import { useState } from 'react';
import { triggerManualSync, usePlatformHealth, useSessionUser } from '../api/client';
import { timeAgo } from '../lib/format';

export function PlatformHealth() {
  const health = usePlatformHealth();
  const { data: user } = useSessionUser();
  const [syncState, setSyncState] = useState<'idle' | 'ok' | 'error'>('idle');

  const canSync = user && (user.role === 'admin' || user.role === 'owner');

  async function onSync() {
    try {
      await triggerManualSync();
      setSyncState('ok');
    } catch {
      setSyncState('error');
    }
  }

  return (
    <>
      <h1 className="page-title">Platform Health</h1>
      <p className="page-subtitle">
        Sync engine, webhook flow, and provider connections — RepoWrangler monitoring itself.
      </p>

      {health.data && (
        <>
          <div className="summary-strip">
            <div className="stat-card">
              <div className="value">{health.data.sync.pendingJobs}</div>
              <div className="label">Pending sync jobs</div>
            </div>
            <div className={`stat-card${health.data.sync.failedJobs > 0 ? ' warn' : ''}`}>
              <div className="value">{health.data.sync.failedJobs}</div>
              <div className="label">Failed sync jobs</div>
            </div>
            <div className="stat-card">
              <div className="value">{health.data.webhooks.received24h}</div>
              <div className="label">Webhooks (24h)</div>
            </div>
            <div className={`stat-card${health.data.webhooks.failed24h > 0 ? ' warn' : ''}`}>
              <div className="value">{health.data.webhooks.failed24h}</div>
              <div className="label">Webhook failures (24h)</div>
            </div>
            <div className="stat-card">
              <div className="value" style={{ fontSize: 16 }}>
                v{health.data.version}
              </div>
              <div className="label">Application version</div>
            </div>
          </div>

          <div className="panel table-scroll">
            <h2>Provider connections</h2>
            <table className="data">
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Connection</th>
                  <th>Status</th>
                  <th>Last success</th>
                  <th>Last error</th>
                </tr>
              </thead>
              <tbody>
                {health.data.connections.map((connection, index) => (
                  <tr key={index}>
                    <td>{connection.provider}</td>
                    <td>{connection.displayName}</td>
                    <td>
                      <span
                        className={`badge ${connection.status === 'active' ? 'healthy' : 'medium'}`}
                      >
                        {connection.status}
                      </span>
                    </td>
                    <td>{timeAgo(connection.lastSuccessAt)}</td>
                    <td className="mono">{connection.lastErrorCode ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {canSync && !health.data.demoMode && (
            <div className="panel">
              <h2>Manual reconciliation</h2>
              <p className="muted">
                Enqueue a full discovery pass. Runs in bounded, checkpointed batches on the next
                scheduled ticks.
              </p>
              <button onClick={onSync}>Run discovery now</button>
              {syncState === 'ok' && <span style={{ marginLeft: 10 }}>✓ Enqueued</span>}
              {syncState === 'error' && (
                <span style={{ marginLeft: 10 }} className="capability">
                  Failed — check your role and connection.
                </span>
              )}
            </div>
          )}
        </>
      )}
    </>
  );
}
