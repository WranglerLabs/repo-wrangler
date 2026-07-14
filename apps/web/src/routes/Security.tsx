import { Link } from 'react-router-dom';
import { useEstateSecurity } from '../api/client';
import { timeAgo } from '../lib/format';
import { useVirtualWindow } from '../lib/useVirtualWindow';
import { ROW_HEIGHT, VIEWPORT_HEIGHT, VIRTUALIZE_ABOVE } from '../lib/listViewport';

const CATEGORY_LABELS: Record<string, string> = {
  secret_scanning: 'Secret scanning',
  code_scanning: 'Code scanning',
  dependency: 'Dependency',
  vulnerability: 'Vulnerability',
};

function severityBadge(severity?: string): string {
  if (severity === 'critical') return 'critical';
  if (severity === 'high') return 'high';
  if (severity === 'medium') return 'medium';
  if (severity === 'low') return 'low';
  return 'unknown';
}

export function Security() {
  const findings = useEstateSecurity();
  const items = findings.data ?? [];
  const virtualize = items.length > VIRTUALIZE_ABOVE;
  const win = useVirtualWindow(items.length, ROW_HEIGHT, VIEWPORT_HEIGHT);
  const visible = virtualize ? items.slice(win.start, win.end) : items;

  return (
    <>
      <h1 className="page-title">Security</h1>
      <p className="page-subtitle">
        Open security findings across the estate — metadata only, never secret content.
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
              <th>Category</th>
              <th>Severity</th>
              <th>Finding</th>
              <th>Age</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {findings.isLoading && (
              <tr>
                <td colSpan={6} className="muted">
                  Loading…
                </td>
              </tr>
            )}
            {items.length === 0 && !findings.isLoading && (
              <tr>
                <td colSpan={6} className="muted">
                  No open security findings. Findings appear here when providers expose them and
                  the connection is authorized to read them.
                </td>
              </tr>
            )}
            {virtualize && win.padTop > 0 && (
              <tr aria-hidden>
                <td colSpan={6} style={{ height: win.padTop, padding: 0, border: 'none' }} />
              </tr>
            )}
            {visible.map((finding, index) => (
              <tr key={`${finding.repositoryId}-${win.start + index}`}>
                <td>
                  <Link to={`/repositories/${finding.repositoryId}`}>
                    {finding.repositoryFullName}
                  </Link>
                  <span className="badge outline" style={{ marginLeft: 6 }}>
                    {finding.provider}
                  </span>
                </td>
                <td>{CATEGORY_LABELS[finding.category] ?? finding.category}</td>
                <td>
                  <span className={`badge ${severityBadge(finding.severity)}`}>
                    {finding.severity ?? 'unknown'}
                  </span>
                </td>
                <td>{finding.summary ?? '—'}</td>
                <td>{timeAgo(finding.createdAt)}</td>
                <td>
                  {finding.url && (
                    <a href={finding.url} target="_blank" rel="noreferrer">
                      Investigate ↗
                    </a>
                  )}
                </td>
              </tr>
            ))}
            {virtualize && win.padBottom > 0 && (
              <tr aria-hidden>
                <td colSpan={6} style={{ height: win.padBottom, padding: 0, border: 'none' }} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
