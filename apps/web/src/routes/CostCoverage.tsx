import { CostBillingNav } from '../components/CostBillingNav';
import { useEstateBudgets, useEstateUsage, useRepositories } from '../api/client';
import { buildWorkspaceCoverage, repositoryBudgetCoverage } from '../lib/costIntelligence';
import { CAPABILITY_LABELS } from '../lib/format';

function freshness(value: string | undefined) {
  return value ? new Date(value).toLocaleString() : 'Never successfully observed';
}

export function CostCoverage() {
  const usage = useEstateUsage();
  const budgets = useEstateBudgets();
  const repositories = useRepositories();
  const coverage = buildWorkspaceCoverage(usage.data, budgets.data);
  const repositoryCoverage = repositoryBudgetCoverage(repositories.data ?? [], budgets.data?.items ?? []);
  const uncoveredRepositories = repositoryCoverage.filter((item) => item.budgets.length === 0);
  return <>
    <h1 className="page-title">Coverage &amp; Data Quality</h1>
    <p className="page-subtitle">
      Proves what RepoWrangler checked, which controls apply, and where provider data is missing.
    </p>
    <CostBillingNav />
    <div className="panel table-scroll">
      <table className="data"><thead><tr>
        <th>Organization</th><th>Provider</th><th>Usage capability</th><th>Budget capability</th>
        <th>Copilot subscription</th><th>Copilot seats</th>
        <th>Observed products</th><th>Without matching budget</th><th>Control gaps</th><th>Freshness</th>
      </tr></thead><tbody>{coverage.map((item) => <tr key={item.key}>
        <td>{item.workspaceSlug}</td><td>{item.provider}</td>
        <td>{CAPABILITY_LABELS[item.usageState] ?? item.usageState}</td>
        <td>{CAPABILITY_LABELS[item.budgetState] ?? item.budgetState}</td>
        <td>{CAPABILITY_LABELS[item.copilotSubscriptionState] ?? item.copilotSubscriptionState}</td>
        <td>{CAPABILITY_LABELS[item.copilotSeatState] ?? item.copilotSeatState}</td>
        <td>{item.usageProducts.length ? item.usageProducts.join(', ') : 'No usage returned'}</td>
        <td>{item.uncoveredProducts.length ? item.uncoveredProducts.join(', ') : 'None detected'}</td>
        <td>{item.budgetCount} budget(s) · {item.budgetsWithoutAlerts} without alerts · {item.softBudgets} soft</td>
        <td>Usage: {freshness(item.latestUsageAt)}<br />Budgets: {freshness(item.latestBudgetAt)}</td>
      </tr>)}{coverage.length === 0 && <tr><td colSpan={10}>Billing capabilities have not been checked yet.</td></tr>}</tbody></table>
    </div>
    <div className="panel table-scroll">
      <h2>Repository budget coverage</h2>
      <p className="muted">A broader organization or enterprise budget is labeled inherited; it is not represented as a direct repository setting.</p>
      <table className="data"><thead><tr><th>Repository</th><th>Provider</th><th>Direct budgets</th><th>Inherited budgets</th><th>Coverage</th></tr></thead>
        <tbody>{repositoryCoverage.map((item) => <tr key={item.repositoryId}>
          <td className="mono">{item.repositoryFullName}</td><td>{item.provider}</td>
          <td>{item.direct}</td><td>{item.inherited}</td>
          <td>{item.budgets.length ? 'At least one applicable control' : 'No applicable configured budget returned'}</td>
        </tr>)}{repositoryCoverage.length === 0 && <tr><td colSpan={5}>No monitored repositories were returned.</td></tr>}</tbody></table>
      <p className="muted">{uncoveredRepositories.length} of {repositoryCoverage.length} monitored repositories have no applicable configured budget returned by the provider.</p>
    </div>
    <div className="panel">
      <h2>Known collection boundaries</h2>
      <ul className="attention-list">
        <li>Organization GitHub App connections collect organization billing scopes.</li>
        <li>Enterprise, cost-center, personal-account, license-price, and included-allowance collection are not configured in this release.</li>
        <li>A successful empty provider response is different from an unauthorized or unsupported response.</li>
      </ul>
    </div>
  </>;
}
