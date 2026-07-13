import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useRepositoryDetail } from '../api/client';
import {
  AttentionBadge,
  BranchStatusBadge,
  RunBadge,
  SeverityBadge,
} from '../components/Badges';
import { CAPABILITY_LABELS, timeAgo } from '../lib/format';

const TABS = [
  'Overview',
  'Branches',
  'Pipelines',
  'Change Requests',
  'Security',
  'Governance',
  'Budgets',
  'Activity',
  'Capabilities',
] as const;

export function RepositoryDetail() {
  const { id } = useParams();
  const detail = useRepositoryDetail(id);
  const [tab, setTab] = useState<(typeof TABS)[number]>('Overview');

  if (detail.isLoading) return <p className="muted">Loading…</p>;
  if (detail.isError || !detail.data) {
    return (
      <div className="error-box">
        Repository not found. <Link to="/repositories">Back to inventory</Link>
      </div>
    );
  }

  const {
    repository,
    healthFindings,
    branches,
    pipelineRuns,
    changeRequests,
    security,
    governance,
    budgets,
  } = detail.data;

  return (
    <>
      <p style={{ margin: '0 0 6px' }}>
        <Link to="/repositories">← Repositories</Link>
      </p>
      <h1 className="page-title">
        {repository.fullName}{' '}
        <AttentionBadge level={repository.attentionLevel} />
      </h1>
      <p className="page-subtitle">
        {repository.description ?? 'No description.'}{' '}
        {repository.url && (
          <a href={repository.url} target="_blank" rel="noreferrer">
            Open on {repository.provider} ↗
          </a>
        )}
      </p>

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'Overview' && (
        <>
          <div className="summary-strip">
            <div className="stat-card">
              <div className="value mono" style={{ fontSize: 16 }}>
                {repository.defaultBranch ?? '—'}
              </div>
              <div className="label">Default branch</div>
            </div>
            <div className="stat-card">
              <div className="value">
                <BranchStatusBadge status={repository.defaultBranchStatus} />
              </div>
              <div className="label">Branch state</div>
            </div>
            <div className="stat-card">
              <div className="value">
                <RunBadge
                  conclusion={repository.latestRunConclusion}
                  at={repository.latestRunAt}
                />
              </div>
              <div className="label">Latest default-branch run</div>
            </div>
            <div className="stat-card">
              <div className="value">{repository.openChangeRequests}</div>
              <div className="label">Open change requests</div>
            </div>
            <div className="stat-card">
              <div className="value" style={{ fontSize: 16 }}>
                {timeAgo(repository.pushedAt)}
              </div>
              <div className="label">Last push</div>
            </div>
          </div>

          <div className="panel">
            <h2>Health findings</h2>
            {healthFindings.length === 0 && <p className="muted">No findings. All rules pass.</p>}
            {healthFindings.map((finding, index) => (
              <div className="attention-item" key={`${finding.code}-${index}`}>
                <SeverityBadge severity={finding.severity} />
                <span className="mono">{finding.code}</span>
                <span className="message">{finding.message}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === 'Branches' && (
        <div className="panel table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>Branch</th>
                <th>Head age</th>
                <th>Ahead</th>
                <th>Behind</th>
                <th>State</th>
                <th>PR/MR</th>
                <th>Protected</th>
              </tr>
            </thead>
            <tbody>
              {branches.map((branch) => (
                <tr key={branch.name}>
                  <td className="mono">
                    {branch.name}
                    {branch.isDefault && (
                      <span className="badge outline" style={{ marginLeft: 6 }}>
                        default
                      </span>
                    )}
                    {branch.excluded && (
                      <span
                        className="badge outline"
                        style={{ marginLeft: 6 }}
                        title={branch.excludedReason}
                      >
                        excluded
                      </span>
                    )}
                  </td>
                  <td>{timeAgo(branch.headCommittedAt)}</td>
                  <td>{branch.aheadBy ?? '—'}</td>
                  <td>{branch.behindBy ?? '—'}</td>
                  <td>
                    <span className="mono">{branch.comparisonStatus}</span>
                  </td>
                  <td>{branch.openChangeRequestNumber ? `#${branch.openChangeRequestNumber}` : '—'}</td>
                  <td>{branch.isProtected ? 'yes' : 'no'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'Pipelines' && (
        <div className="panel table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>Run</th>
                <th>Branch</th>
                <th>Status</th>
                <th>Started</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {pipelineRuns.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    No runs observed yet.
                  </td>
                </tr>
              )}
              {pipelineRuns.map((run) => (
                <tr key={run.externalId}>
                  <td>
                    {run.url ? (
                      <a href={run.url} target="_blank" rel="noreferrer">
                        {run.name ?? run.externalId} ↗
                      </a>
                    ) : (
                      (run.name ?? run.externalId)
                    )}
                  </td>
                  <td className="mono">{run.branch ?? '—'}</td>
                  <td>
                    <RunBadge conclusion={run.conclusion ?? run.status} />
                  </td>
                  <td>{timeAgo(run.runStartedAt)}</td>
                  <td>{run.durationSeconds !== undefined ? `${run.durationSeconds}s` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'Change Requests' && (
        <div className="panel table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>#</th>
                <th>Title</th>
                <th>Author</th>
                <th>Base ← Head</th>
                <th>Mergeable</th>
                <th>Checks</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {changeRequests.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    No open change requests.
                  </td>
                </tr>
              )}
              {changeRequests.map((cr) => (
                <tr key={cr.number}>
                  <td>
                    {cr.url ? (
                      <a href={cr.url} target="_blank" rel="noreferrer">
                        #{cr.number}
                      </a>
                    ) : (
                      `#${cr.number}`
                    )}
                  </td>
                  <td>
                    {cr.isDraft && (
                      <span className="badge outline" style={{ marginRight: 6 }}>
                        draft
                      </span>
                    )}
                    {cr.title}
                  </td>
                  <td>{cr.author ?? '—'}</td>
                  <td className="mono">
                    {cr.baseRef} ← {cr.headRef}
                  </td>
                  <td>{cr.mergeableState ?? '—'}</td>
                  <td>{cr.checksStatus ?? '—'}</td>
                  <td>{timeAgo(cr.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'Security' && (
        <div className="panel">
          <h2>Security findings</h2>
          {security.state !== 'available' ? (
            <p className="capability">
              {CAPABILITY_LABELS[security.state] ?? security.state} — this is a capability state,
              not a count of zero.
            </p>
          ) : (security.findings ?? []).length === 0 ? (
            <p className="muted">No open findings.</p>
          ) : (
            (security.findings ?? []).map((finding, index) => (
              <div className="attention-item" key={index}>
                <SeverityBadge severity={finding.severity ?? 'unknown'} />
                <span className="mono">{finding.category}</span>
                <span className="message">{finding.summary ?? 'Details on provider.'}</span>
                {finding.url && (
                  <a href={finding.url} target="_blank" rel="noreferrer">
                    Investigate ↗
                  </a>
                )}
              </div>
            ))
          )}
          <p className="muted" style={{ marginTop: 12 }}>
            RepoWrangler stores redacted metadata only — investigate details on the provider.
          </p>
        </div>
      )}

      {tab === 'Governance' && (
        <div className="panel">
          <h2>Governance</h2>
          {!governance || governance.state !== 'available' ? (
            <p className="capability">
              {CAPABILITY_LABELS[governance?.state ?? 'not_configured'] ?? governance?.state} —
              governance data is collected during repository enrichment.
            </p>
          ) : (
            <table className="data">
              <tbody>
                <tr>
                  <td className="muted" style={{ width: 240 }}>
                    Default branch protection
                  </td>
                  <td>
                    {governance.defaultBranchProtected === undefined ? (
                      <span className="capability">unknown</span>
                    ) : governance.defaultBranchProtected ? (
                      <span className="badge healthy">protected</span>
                    ) : (
                      <span className="badge medium">not protected</span>
                    )}
                  </td>
                </tr>
                {governance.files &&
                  Object.entries(governance.files).map(([file, present]) => (
                    <tr key={file}>
                      <td className="muted">{file}</td>
                      <td>
                        {present ? (
                          <span className="badge healthy">present</span>
                        ) : (
                          <span className="badge low">missing</span>
                        )}
                      </td>
                    </tr>
                  ))}
                {governance.healthPercentage !== undefined && (
                  <tr>
                    <td className="muted">Community health score</td>
                    <td>{governance.healthPercentage}%</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'Budgets' && (
        <div className="panel">
          <h2>Budgets &amp; usage</h2>
          {budgets.state !== 'available' ? (
            <p className="capability">
              {CAPABILITY_LABELS[budgets.state] ?? budgets.state} — this is a capability state,
              not zero budgets. Collection depends on organization plan and permissions.
            </p>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Scope</th>
                  <th>Amount</th>
                  <th>Hard stop</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {(budgets.items ?? []).map((budget, index) => (
                  <tr key={index}>
                    <td>{budget.product ?? '—'}</td>
                    <td>
                      {budget.scopeType ?? '—'}
                      {budget.scopeTarget ? ` (${budget.scopeTarget})` : ''}
                    </td>
                    <td>
                      {budget.amount !== undefined
                        ? `${budget.amount} ${budget.unit ?? ''}`
                        : '—'}
                    </td>
                    <td>{budget.preventFurtherUsage ? 'yes' : 'no'}</td>
                    <td>{budget.alertStatus ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'Activity' && (
        <div className="panel">
          <h2>Activity &amp; sync history</h2>
          <table className="data">
            <tbody>
              <tr>
                <td className="muted" style={{ width: 240 }}>
                  Last push (provider)
                </td>
                <td>{timeAgo(repository.pushedAt)}</td>
              </tr>
              <tr>
                <td className="muted">Latest default-branch run</td>
                <td>{timeAgo(repository.latestRunAt)}</td>
              </tr>
              <tr>
                <td className="muted">Last synced by RepoWrangler</td>
                <td>{timeAgo(repository.lastSyncedAt)}</td>
              </tr>
              <tr>
                <td className="muted">Monitoring state</td>
                <td className="mono">{repository.status}</td>
              </tr>
            </tbody>
          </table>
          <p className="muted" style={{ marginTop: 12 }}>
            Freshness is snapshot-based: data is served from the last successful sync, so a stale
            timestamp signals a sync problem — not missing activity.
          </p>
        </div>
      )}

      {tab === 'Capabilities' && (
        <div className="panel">
          <h2>Provider capabilities</h2>
          <p className="muted" style={{ marginBottom: 12 }}>
            Each capability reports its own state. &ldquo;Not authorized&rdquo; or
            &ldquo;unsupported&rdquo; is never shown as a count of zero.
          </p>
          <table className="data">
            <thead>
              <tr>
                <th>Capability</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {[
                { label: 'Security findings', state: security.state },
                { label: 'Governance', state: governance?.state ?? 'not_configured' },
                { label: 'Budgets & usage', state: budgets.state },
              ].map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td>
                    {row.state === 'available' ? (
                      <span className="badge healthy">available</span>
                    ) : (
                      <span className="capability">
                        {CAPABILITY_LABELS[row.state] ?? row.state}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
