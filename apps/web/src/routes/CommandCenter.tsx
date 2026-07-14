import { Link } from 'react-router-dom';
import { useAttention, useOverview } from '../api/client';
import { CapabilityText, SeverityBadge } from '../components/Badges';
import { timeAgo } from '../lib/format';
import { useVirtualWindow } from '../lib/useVirtualWindow';
import { ROW_HEIGHT, VIEWPORT_HEIGHT, VIRTUALIZE_ABOVE } from '../lib/listViewport';

export function CommandCenter() {
  const overview = useOverview();
  const attention = useAttention();

  // B10: on a large estate the attention queue itself is what grows the page
  // unbounded — contain it in a scroll panel and virtualize the same way
  // Repositories.tsx does, once it's big enough to matter.
  const attentionItems = attention.data ?? [];
  const virtualizeAttention = attentionItems.length > VIRTUALIZE_ABOVE;
  const attentionWin = useVirtualWindow(attentionItems.length, ROW_HEIGHT, VIEWPORT_HEIGHT);
  const visibleAttention = virtualizeAttention
    ? attentionItems.slice(attentionWin.start, attentionWin.end)
    : attentionItems;

  return (
    <>
      <h1 className="page-title">Command Center</h1>
      <p className="page-subtitle">Everything requiring attention across your estate, first.</p>

      {overview.isError && (
        <div className="error-box">Could not load the overview. Is the API reachable?</div>
      )}

      {overview.data && (
        <div className="summary-strip">
          <div className="stat-card">
            <div className="value">{overview.data.workspaces}</div>
            <div className="label">Workspaces</div>
          </div>
          <div className="stat-card">
            <div className="value">{overview.data.repositories}</div>
            <div className="label">Repositories</div>
          </div>
          <div className={`stat-card${overview.data.failingPipelines > 0 ? ' warn' : ''}`}>
            <div className="value">{overview.data.failingPipelines}</div>
            <div className="label">Failing pipelines</div>
          </div>
          <div className="stat-card">
            <div className="value">{overview.data.openChangeRequests}</div>
            <div className="label">Open PRs / MRs</div>
          </div>
          <div className="stat-card">
            <div className="value">{overview.data.branchesAhead}</div>
            <div className="label">Branches ahead</div>
          </div>
          <div className="stat-card">
            <div className="value">
              <CapabilityText
                state={overview.data.securityFindings.state}
                count={overview.data.securityFindings.count}
              />
            </div>
            <div className="label">Security findings</div>
          </div>
          <div className="stat-card">
            <div className="value">
              <CapabilityText
                state={overview.data.budgetWarnings.state}
                count={overview.data.budgetWarnings.count}
              />
            </div>
            <div className="label">Budget warnings</div>
          </div>
          <div className="stat-card">
            <div className="value">{overview.data.newRepositories7d}</div>
            <div className="label">New repos (7d)</div>
          </div>
        </div>
      )}

      <div className="panel">
        <h2>Attention queue</h2>
        {attention.isLoading && <p className="muted">Loading…</p>}
        {attention.data && attention.data.length === 0 && (
          <p className="muted">Nothing needs attention. Enjoy the quiet.</p>
        )}
        {attentionItems.length > 0 && (
          <div
            className="table-scroll"
            style={virtualizeAttention ? { maxHeight: VIEWPORT_HEIGHT, overflowY: 'auto' } : undefined}
            onScroll={virtualizeAttention ? attentionWin.onScroll : undefined}
          >
            {virtualizeAttention && attentionWin.padTop > 0 && (
              <div aria-hidden style={{ height: attentionWin.padTop }} />
            )}
            {visibleAttention.map((item, index) => (
              <div
                className="attention-item"
                key={`${item.repositoryId}-${item.code}-${attentionWin.start + index}`}
              >
                <SeverityBadge severity={item.severity} />
                <span className="repo">
                  {item.repositoryId ? (
                    <Link to={`/repositories/${item.repositoryId}`}>{item.repositoryFullName}</Link>
                  ) : (
                    item.repositoryFullName
                  )}
                </span>
                <span className="message">{item.message}</span>
                <span className="muted" style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}>
                  {timeAgo(item.observedAt)}
                </span>
              </div>
            ))}
            {virtualizeAttention && attentionWin.padBottom > 0 && (
              <div aria-hidden style={{ height: attentionWin.padBottom }} />
            )}
          </div>
        )}
      </div>

      {overview.data && overview.data.inaccessibleRepositories > 0 && (
        <div className="panel">
          <h2>Estate warnings</h2>
          <p>
            {overview.data.inaccessibleRepositories} repositories are no longer accessible
            (removed, transferred, or permission lost). They are retained as tombstones —{' '}
            <Link to="/repositories">review the inventory</Link>.
          </p>
        </div>
      )}
    </>
  );
}
