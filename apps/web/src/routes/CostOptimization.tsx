import { CostBillingNav } from '../components/CostBillingNav';
import { useEstateBudgets, useEstateUsage } from '../api/client';
import {
  copilotSeatOpportunities,
  detectCostAnomalies,
  isActionsUsage,
  knownTotal,
} from '../lib/costIntelligence';

function money(value: number | undefined) {
  return value === undefined ? 'Unavailable'
    : new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(value);
}

export function CostOptimization() {
  const usage = useEstateUsage();
  const budgets = useEstateBudgets();
  const items = usage.data?.items ?? [];
  const anomalies = detectCostAnomalies(items, new Date());
  const seats = copilotSeatOpportunities(budgets.data?.copilotSubscriptions ?? []);
  const seatCapabilities = budgets.data?.copilotSeatCapabilities ?? [];
  const userSeats = (budgets.data?.copilotSeats ?? []).filter((seat) => seat.status === 'active')
    .sort((left, right) => (left.lastActivityAt ?? '').localeCompare(right.lastActivityAt ?? ''));
  const actionsByRepository = new Map<string, typeof items>();
  for (const item of items.filter((candidate) => isActionsUsage(candidate) && candidate.repositoryFullName)) {
    const key = item.repositoryFullName!;
    actionsByRepository.set(key, [...(actionsByRepository.get(key) ?? []), item]);
  }
  const actionCandidates = [...actionsByRepository.entries()].map(([repository, rows]) => ({
    repository,
    cost: knownTotal(rows, (item) => item.netAmount),
    minutes: knownTotal(rows.filter((item) => (item.unitType ?? '').toLowerCase().includes('minute')),
      (item) => item.netQuantity ?? item.quantity),
  })).sort((left, right) => (right.cost.value ?? -1) - (left.cost.value ?? -1)).slice(0, 20);
  const storageGroups = new Map<string, typeof items>();
  for (const item of items.filter((candidate) => /storage|cache|artifact|bandwidth|git.?lfs/i
    .test(`${candidate.product} ${candidate.sku}`))) {
    const key = `${item.product} · ${item.sku}`;
    storageGroups.set(key, [...(storageGroups.get(key) ?? []), item]);
  }
  const storageCandidates = [...storageGroups.entries()].map(([label, rows]) => ({
    label,
    quantity: knownTotal(rows, (item) => item.netQuantity ?? item.quantity),
    cost: knownTotal(rows, (item) => item.netAmount),
    unit: rows.find((item) => item.unitType)?.unitType,
    repositories: new Set(rows.map((item) => item.repositoryFullName).filter(Boolean)).size,
    unattributed: rows.filter((item) => !item.repositoryFullName).length,
  })).sort((left, right) => (right.cost.value ?? -1) - (left.cost.value ?? -1));

  return <>
    <h1 className="page-title">Cost Optimization</h1>
    <p className="page-subtitle">
      Read-only findings that identify where investigation is likely to save money. RepoWrangler never changes provider billing controls.
    </p>
    <CostBillingNav />

    <div className="panel table-scroll">
      <h2>Copilot seat review</h2>
      <table className="data"><thead><tr><th>Organization</th><th>Plan reported by GitHub</th><th>Total</th><th>Active</th><th>Inactive</th><th>Pending cancellation</th><th>Finding</th></tr></thead>
        <tbody>{seats.map((item) => <tr key={`${item.provider}:${item.workspaceSlug}`}>
          <td>{item.workspaceSlug}</td><td>{item.planType}</td><td>{item.totalSeats}</td>
          <td>{item.activeSeats ?? 'Unavailable'}</td><td>{item.inactiveSeats ?? 'Unavailable'}</td>
          <td>{item.pendingCancellation ?? 'Unavailable'}</td>
          <td>{item.state === 'no_assigned_seats' ? 'No organization-assigned seats; do not infer an active paid subscription.'
            : item.state === 'review_inactive_seats' ? 'Review inactive seats for potential removal.' : 'No inactive-seat signal detected.'}</td>
        </tr>)}{seats.length === 0 && <tr><td colSpan={7}>Copilot seat capability has not returned data.</td></tr>}</tbody>
      </table>
    </div>

    <div className="panel table-scroll">
      <h2>Copilot users</h2>
      <p className="muted">Activity is a review signal, not an automatic removal decision. Missing telemetry remains unavailable.</p>
      {seatCapabilities.map((capability) => <p className="capability" key={`${capability.provider}:${capability.workspaceSlug}`}>
        {capability.workspaceSlug}: {capability.state}{capability.errorCode ? ` · ${capability.errorCode}` : ''}
        {capability.detail ? ` · ${capability.detail}` : ''} · checked {capability.checkedAt}
      </p>)}
      <table className="data"><thead><tr><th>Organization</th><th>User</th><th>Plan</th><th>Assigning team</th><th>Last activity</th><th>Last authenticated</th><th>Cancellation</th></tr></thead>
        <tbody>{userSeats.map((seat) => <tr key={`${seat.provider}:${seat.workspaceSlug}:${seat.externalUserId}`}>
          <td>{seat.workspaceSlug}</td><td>{seat.userLogin}</td><td>{seat.planType ?? 'Unavailable'}</td>
          <td>{seat.assigningTeamSlug ?? 'Direct or unreported'}</td>
          <td>{seat.lastActivityAt ? new Date(seat.lastActivityAt).toLocaleString() : 'Unavailable'}</td>
          <td>{seat.lastAuthenticatedAt ? new Date(seat.lastAuthenticatedAt).toLocaleString() : 'Unavailable'}</td>
          <td>{seat.pendingCancellationAt ?? 'None reported'}</td>
        </tr>)}{userSeats.length === 0 && <tr><td colSpan={7}>{seatCapabilities.length > 0
          && seatCapabilities.every((item) => item.state === 'available')
          ? 'GitHub successfully returned no active organization-billed Copilot seats.'
          : 'Active organization-billed Copilot seats are unavailable until the seat capability succeeds.'}</td></tr>}</tbody></table>
    </div>

    <div className="panel table-scroll">
      <h2>Recent cost anomalies</h2>
      <p className="muted">Compares the most recent seven UTC days with the preceding seven days. Only provider rows with daily net cost are evaluated.</p>
      <table className="data"><thead><tr><th>Organization</th><th>Repository / attribution</th><th>Product</th><th>Recent 7 days</th><th>Previous 7 days</th><th>Change</th></tr></thead>
        <tbody>{anomalies.map((item) => <tr key={item.key}><td>{item.workspaceSlug}</td>
          <td>{item.repositoryFullName ?? 'Unattributed'}</td><td>{item.product}</td>
          <td>{money(item.recentNet)}</td><td>{money(item.previousNet)}</td>
          <td>{item.changePercent === undefined ? 'New cost' : `+${item.changePercent.toFixed(1)}%`}</td>
        </tr>)}{anomalies.length === 0 && <tr><td colSpan={6}>No cost anomaly meets the current evidence threshold.</td></tr>}</tbody></table>
    </div>

    <div className="panel table-scroll">
      <h2>Highest-cost Actions repositories</h2>
      <p className="muted">Candidates for workflow, runner-OS, retry, cache, and artifact-retention review.</p>
      <table className="data"><thead><tr><th>Repository</th><th>Net cost</th><th>Actions minutes</th><th>Recommended review</th></tr></thead>
        <tbody>{actionCandidates.map((item) => <tr key={item.repository}><td className="mono">{item.repository}</td>
          <td>{money(item.cost.value)}</td><td>{item.minutes.value?.toLocaleString() ?? 'Unavailable'}</td>
          <td>Inspect expensive workflows, failures, retries, runner SKUs, caches, and artifact retention.</td>
        </tr>)}{actionCandidates.length === 0 && <tr><td colSpan={4}>No repository-attributed Actions usage was returned.</td></tr>}</tbody></table>
    </div>

    <div className="panel table-scroll">
      <h2>Storage, cache, artifact, and bandwidth review</h2>
      <table className="data"><thead><tr><th>Product / SKU</th><th>Quantity</th><th>Net cost</th><th>Repositories</th><th>Unattributed records</th><th>Recommended review</th></tr></thead>
        <tbody>{storageCandidates.map((item) => <tr key={item.label}><td>{item.label}</td>
          <td>{item.quantity.value === undefined ? 'Unavailable' : `${item.quantity.value.toLocaleString()} ${item.unit ?? ''}`}</td>
          <td>{money(item.cost.value)}</td><td>{item.repositories}</td><td>{item.unattributed}</td>
          <td>Review retention, stale artifacts, unused caches, package cleanup, and bandwidth sources.</td>
        </tr>)}{storageCandidates.length === 0 && <tr><td colSpan={6}>No provider storage, cache, artifact, or bandwidth usage was returned.</td></tr>}</tbody></table>
    </div>
  </>;
}
