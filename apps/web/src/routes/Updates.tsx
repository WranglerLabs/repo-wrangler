import { useState } from 'react';
import type { PrepareUpgradeDto } from '@repo-wrangler/contracts';
import {
  executeUpgradeAction,
  prepareUpgrade,
  prepareUpgradeAction,
  requestUpgrade,
  useAdministrationUpdates,
  useUpgradeJob,
  type UpgradeAction,
  type UpgradeJobDto,
} from '../api/client';
import {
  availableJobActions,
  isActiveUpgradeJob,
  upgradeAvailabilityMessage,
  upgradeEvidenceFacts,
  upgradeStateBadge,
  upgradeStateLabel,
} from '../lib/upgradeView';

type Confirmation =
  | {
      kind: 'upgrade';
      prepared: PrepareUpgradeDto;
      idempotencyKey: string;
      acknowledged: boolean;
    }
  | {
      kind: 'action';
      action: UpgradeAction;
      job: UpgradeJobDto;
      approvalToken: string;
      acknowledged: boolean;
    };

function displayTime(value: string | undefined): string {
  if (!value) return 'Not available';
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? value : parsed.toLocaleString();
}

function shortDigest(value: string | undefined): string {
  if (!value) return 'Not available';
  return value.length > 28 ? `${value.slice(0, 19)}…${value.slice(-8)}` : value;
}

function checkBadge(status: string): string {
  if (status === 'passed' || status === 'verified') return 'healthy';
  if (status === 'failed') return 'critical';
  if (status === 'warning' || status === 'pending') return 'medium';
  return 'unknown';
}

export function Updates() {
  const updates = useAdministrationUpdates();
  const [selectedJobId, setSelectedJobId] = useState<string>();
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();

  const data = updates.data;
  const effectiveJobId = selectedJobId ?? data?.jobs[0]?.id;
  const detail = useUpgradeJob(effectiveJobId);
  const selectedJob = detail.data?.job
    ?? data?.jobs.find((job) => job.id === effectiveJobId);

  async function beginUpgrade() {
    if (!data?.evaluation.availableVersion || !data.evaluation.imageDigest) return;
    setBusy(true);
    setActionError(undefined);
    try {
      const prepared = await prepareUpgrade(
        data.evaluation.availableVersion,
        data.evaluation.imageDigest,
      );
      setConfirmation({
        kind: 'upgrade', prepared,
        idempotencyKey: `web:${crypto.randomUUID()}`,
        acknowledged: false,
      });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Upgrade preflight failed.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmUpgrade() {
    if (confirmation?.kind !== 'upgrade' || !confirmation.acknowledged) return;
    setBusy(true);
    setActionError(undefined);
    try {
      const response = await requestUpgrade(confirmation.prepared, confirmation.idempotencyKey);
      setSelectedJobId(response.job.id);
      setConfirmation(undefined);
      await updates.refetch();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Upgrade request failed.');
    } finally {
      setBusy(false);
    }
  }

  async function beginJobAction(job: UpgradeJobDto, action: UpgradeAction) {
    setBusy(true);
    setActionError(undefined);
    try {
      const prepared = await prepareUpgradeAction(job.id, action);
      setConfirmation({
        kind: 'action', action, job: prepared.job,
        approvalToken: prepared.approvalToken, acknowledged: false,
      });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : `Could not prepare ${action}.`);
    } finally {
      setBusy(false);
    }
  }

  async function confirmJobAction() {
    if (confirmation?.kind !== 'action' || !confirmation.acknowledged) return;
    setBusy(true);
    setActionError(undefined);
    try {
      const response = await executeUpgradeAction(
        confirmation.job.id, confirmation.action, confirmation.approvalToken,
      );
      setSelectedJobId(response.job.id);
      setConfirmation(undefined);
      await Promise.all([updates.refetch(), detail.refetch()]);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Protected action failed.');
    } finally {
      setBusy(false);
    }
  }

  if (updates.isLoading) return <p className="muted">Checking installed and available releases…</p>;
  if (updates.error || !data) {
    return <div className="error-box">Could not load update status: {updates.error?.message ?? 'Unknown error'}</div>;
  }

  const canStart = data.evaluation.status === 'update_available'
    && data.controller.availability === 'available'
    && data.controller.operations.preflight
    && data.controller.operations.request
    && !data.jobs.some(isActiveUpgradeJob);

  return <>
    <div className="page-heading-row">
      <div>
        <h1 className="page-title">Updates</h1>
        <p className="page-subtitle">
          Release compatibility, protected upgrade execution, verification evidence, and rollback history.
        </p>
      </div>
      <button className="ghost" onClick={() => void updates.refetch()} disabled={updates.isFetching}>
        {updates.isFetching ? 'Checking…' : 'Check again'}
      </button>
    </div>

    {data.sourceError && <div className="error-box">
      Release discovery failed ({data.sourceError.code}): {data.sourceError.detail}
    </div>}
    {actionError && <div className="error-box" role="alert">{actionError}</div>}

    <div className="summary-strip update-summary">
      <div className="stat-card"><div className="value version-value">{data.installedVersion}</div><div className="label">Installed version</div></div>
      <div className="stat-card"><div className="value version-value">{data.evaluation.availableVersion ?? 'Unavailable'}</div><div className="label">Available release</div></div>
      <div className="stat-card"><div className="value version-value">{data.channel}</div><div className="label">Release channel</div></div>
      <div className="stat-card"><div className="value version-value">{data.controller.availability}</div><div className="label">Controller</div></div>
    </div>

    <div className="cost-grid">
      <section className="panel">
        <h2>Release readiness</h2>
        <p>
          <span className={`badge ${data.evaluation.status === 'update_available' ? 'healthy' : data.evaluation.status === 'incompatible_update' ? 'critical' : 'info'}`}>
            {upgradeStateLabel(data.evaluation.status)}
          </span>
        </p>
        <p>{upgradeAvailabilityMessage(data)}</p>
        <dl className="cost-facts">
          <div><dt>Deployment</dt><dd>{data.deploymentTarget}</dd></div>
          <div><dt>Release target</dt><dd>{data.releaseTarget}</dd></div>
          <div><dt>Target digest</dt><dd className="mono" title={data.evaluation.imageDigest}>{shortDigest(data.evaluation.imageDigest)}</dd></div>
          <div><dt>Last checked</dt><dd>{displayTime(data.checkedAt)}</dd></div>
          <div><dt>Manifest</dt><dd><a href={data.manifestUrl} target="_blank" rel="noreferrer">View release metadata ↗</a></dd></div>
        </dl>
        {data.evaluation.releaseNotesUrl && <p><a href={data.evaluation.releaseNotesUrl} target="_blank" rel="noreferrer">Read release notes ↗</a></p>}
        {canStart && <button onClick={() => void beginUpgrade()} disabled={busy}>Run protected preflight</button>}
        {!canStart && data.evaluation.status === 'update_available' && <p className="muted">
          An upgrade cannot start while another job is active or the configured controller is unavailable.
        </p>}
      </section>

      <section className="panel">
        <h2>Compatibility checks</h2>
        <div className="check-list">
          {data.evaluation.checks.map((check) => <div className="check-row" key={check.id}>
            <span className={`badge ${checkBadge(check.status)}`}>{check.status}</span>
            <div><strong>{upgradeStateLabel(check.id)}</strong><div className="muted">{check.detail}</div></div>
          </div>)}
          {data.evaluation.checks.length === 0 && <p className="muted">Compatibility data is unavailable.</p>}
        </div>
        <h2 className="subheading">Required approvals</h2>
        <ul className="attention-list">
          <li>RepoWrangler preflight and exact version/digest confirmation</li>
          <li>One-time, actor-bound approval token for every upgrade, cancel, or rollback</li>
          <li>Deployment-controller approval before production traffic changes, when configured</li>
        </ul>
      </section>
    </div>

    {data.controller.availability !== 'available' && <section className="panel">
      <h2>Manual deployment procedure</h2>
      <p>{data.controller.detail}</p>
      <ol className="attention-list">
        {data.controller.manualInstructions?.map((instruction) => <li key={instruction}>{instruction}</li>)}
      </ol>
      <p className="muted">RepoWrangler does not claim one-click support for this deployment target.</p>
    </section>}

    {confirmation && <section className="panel confirmation-panel" aria-live="polite">
      <h2>{confirmation.kind === 'upgrade' ? 'Confirm protected upgrade' : `Confirm ${confirmation.action}`}</h2>
      {confirmation.kind === 'upgrade' ? <>
        <p>
          Preflight for <strong>{confirmation.prepared.target.targetVersion}</strong> is{' '}
          <span className={`badge ${confirmation.prepared.preflight.ready ? 'healthy' : 'critical'}`}>
            {confirmation.prepared.preflight.ready ? 'ready' : 'not ready'}
          </span>
        </p>
        <div className="check-list">
          {confirmation.prepared.preflight.checks.map((check) => <div className="check-row" key={check.id}>
            <span className={`badge ${checkBadge(check.status)}`}>{check.status}</span>
            <div><strong>{upgradeStateLabel(check.id)}</strong>{check.detail && <div className="muted">{check.detail}</div>}</div>
          </div>)}
        </div>
        {confirmation.prepared.preflight.irreversibleChanges.length > 0 && <div className="error-box">
          <strong>Irreversible changes:</strong>
          <ul>{confirmation.prepared.preflight.irreversibleChanges.map((item) => <li key={item}>{item}</li>)}</ul>
        </div>}
        <p className="muted">Approval expires {displayTime(confirmation.prepared.approvalExpiresAt)}. The external controller will still enforce backup, restored-database migration, artifact, health, and rollback gates.</p>
      </> : <p>
        This will request <strong>{confirmation.action}</strong> for {confirmation.job.targetVersion} through the trusted deployment controller. It does not bypass controller safety checks or external approvals.
      </p>}
      <label className="confirmation-check">
        <input type="checkbox" checked={confirmation.acknowledged} onChange={(event) => setConfirmation({ ...confirmation, acknowledged: event.target.checked })}/>
        <span>I confirm this exact protected action and understand that it creates an immutable audit event.</span>
      </label>
      <div className="form-actions">
        <button
          onClick={() => void (confirmation.kind === 'upgrade' ? confirmUpgrade() : confirmJobAction())}
          disabled={busy || !confirmation.acknowledged || (confirmation.kind === 'upgrade' && !confirmation.prepared.preflight.ready)}
        >
          {busy ? 'Submitting…' : confirmation.kind === 'upgrade' ? `Upgrade to ${confirmation.prepared.target.targetVersion}` : `Request ${confirmation.action}`}
        </button>
        <button className="ghost" onClick={() => setConfirmation(undefined)} disabled={busy}>Do not proceed</button>
      </div>
    </section>}

    <section className="panel table-scroll">
      <h2>Upgrade and rollback history</h2>
      <table className="data"><thead><tr>
        <th>Requested</th><th>Target</th><th>State</th><th>Actor</th><th>Controller run</th><th>Completed</th><th></th>
      </tr></thead><tbody>
        {data.jobs.map((job) => <tr key={job.id}>
          <td>{displayTime(job.requestedAt)}<br/><span className="mono muted">{job.id}</span></td>
          <td>{job.sourceVersion} → {job.targetVersion}<br/><span className="mono muted" title={job.targetDigest}>{shortDigest(job.targetDigest)}</span></td>
          <td><span className={`badge ${upgradeStateBadge(job.state)}`}>{upgradeStateLabel(job.state)}</span></td>
          <td>{job.actorDisplayName ?? job.actorId}</td>
          <td className="mono">{job.controllerCorrelationId ?? 'Not accepted'}</td>
          <td>{displayTime(job.completedAt)}</td>
          <td><button className="ghost" onClick={() => setSelectedJobId(job.id)}>Evidence</button></td>
        </tr>)}
        {data.jobs.length === 0 && <tr><td colSpan={7} className="muted">No upgrade requests have been recorded.</td></tr>}
      </tbody></table>
    </section>

    {selectedJob && <section className="panel">
      <div className="detail-heading">
        <div>
          <h2>Job evidence: {selectedJob.targetVersion}</h2>
          <div className="muted mono">Correlation {selectedJob.correlationId} · controller {selectedJob.controllerCorrelationId ?? 'not accepted'}</div>
        </div>
        <span className={`badge ${upgradeStateBadge(selectedJob.state)}`}>{upgradeStateLabel(selectedJob.state)}</span>
      </div>
      {selectedJob.safeErrorCode && <div className="error-box">
        <strong>{selectedJob.safeErrorCode}</strong>{selectedJob.safeErrorDetail ? ` — ${selectedJob.safeErrorDetail}` : ''}
      </div>}
      <div className="evidence-grid">
        {upgradeEvidenceFacts(selectedJob).map((fact) => <div className="evidence-card" key={fact.id}>
          <span className={`badge ${checkBadge(fact.state)}`}>{fact.state}</span>
          <strong>{fact.label}</strong>
          <span className="muted mono">{fact.detail}</span>
        </div>)}
      </div>
      <div className="form-actions">
        {availableJobActions(selectedJob).map((action) => <button
          key={action}
          className={action === 'rollback' ? 'danger' : 'ghost'}
          onClick={() => void beginJobAction(selectedJob, action)}
          disabled={busy}
        >Prepare {action}</button>)}
      </div>
      <h2 className="subheading">Lifecycle events</h2>
      <div className="table-scroll"><table className="data"><thead><tr>
        <th>Sequence</th><th>Transition</th><th>Time</th><th>Actor</th><th>Detail</th>
      </tr></thead><tbody>
        {detail.data?.events.map((event) => <tr key={event.id}>
          <td>{event.sequence}</td><td>{event.fromState ? `${upgradeStateLabel(event.fromState)} → ` : ''}{upgradeStateLabel(event.toState)}</td>
          <td>{displayTime(event.createdAt)}</td><td>{event.actorId ?? 'controller'}</td><td>{event.detail ?? '—'}</td>
        </tr>)}
        {!detail.data && <tr><td colSpan={5} className="muted">Loading durable lifecycle events…</td></tr>}
      </tbody></table></div>
    </section>}

    <section className="panel table-scroll">
      <h2>Security audit</h2>
      <table className="data"><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Safe detail</th></tr></thead><tbody>
        {data.auditEvents.map((event, index) => <tr key={`${event.createdAt}:${event.action}:${index}`}>
          <td>{displayTime(event.createdAt)}</td><td>{event.actor}</td><td className="mono">{event.action}</td><td>{event.detail ?? '—'}</td>
        </tr>)}
        {data.auditEvents.length === 0 && <tr><td colSpan={4} className="muted">No upgrade audit events have been recorded.</td></tr>}
      </tbody></table>
    </section>
  </>;
}
