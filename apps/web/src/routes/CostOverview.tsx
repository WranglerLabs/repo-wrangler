import { Link } from 'react-router-dom';
import { CostBillingNav } from '../components/CostBillingNav';
import { useEstateBudgets, useEstateUsage } from '../api/client';
import {
  buildWorkspaceCoverage,
  classifyCostNature,
  currentMonthItems,
  forecastCurrentMonth,
  knownTotal,
} from '../lib/costIntelligence';

function money(value: number | undefined, complete = true) {
  if (value === undefined) return 'Unavailable';
  const rendered = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(value);
  return complete ? rendered : `At least ${rendered}`;
}

export function CostOverview() {
  const usage = useEstateUsage();
  const budgets = useEstateBudgets();
  const now = new Date();
  const items = currentMonthItems(usage.data?.items ?? [], now);
  const net = knownTotal(items, (item) => item.netAmount);
  const fixedLicense = knownTotal(items.filter((item) => classifyCostNature(item) === 'fixed_license'),
    (item) => item.netAmount);
  const metered = knownTotal(items.filter((item) => classifyCostNature(item) === 'metered'),
    (item) => item.netAmount);
  const unclassified = knownTotal(items.filter((item) => classifyCostNature(item) === 'unclassified'),
    (item) => item.netAmount);
  const gross = knownTotal(items, (item) => item.grossAmount);
  const discounts = knownTotal(items, (item) => item.discountAmount);
  const unattributed = items.filter((item) => !item.repositoryFullName);
  const unattributedNet = knownTotal(unattributed, (item) => item.netAmount);
  const forecast = forecastCurrentMonth(usage.data?.items ?? [], now);
  const coverage = buildWorkspaceCoverage(usage.data, budgets.data);
  const capabilityProblems = coverage.filter((item) => item.usageState !== 'available'
    || item.budgetState !== 'available').length;
  const uncoveredProducts = coverage.reduce((sum, item) => sum + item.uncoveredProducts.length, 0);
  const subscriptions = budgets.data?.copilotSubscriptions ?? [];
  const assignedSeats = knownTotal(subscriptions, (item) => item.totalSeats);

  return <>
    <h1 className="page-title">Cost &amp; Billing</h1>
    <p className="page-subtitle">
      What the estate costs, what controls apply, where data is incomplete, and what needs attention.
      Provider-reported amounts remain separate from estimates and unavailable values.
    </p>
    <CostBillingNav />

    <div className="summary-strip">
      <div className="stat-card"><div className="value">{money(net.value, net.complete)}</div><div className="label">Current-month provider-reported net cost</div></div>
      <div className="stat-card"><div className="value">{money(gross.value, gross.complete)}</div><div className="label">Gross metered cost</div></div>
      <div className="stat-card"><div className="value">{money(discounts.value, discounts.complete)}</div><div className="label">Provider discounts</div></div>
      <div className="stat-card"><div className="value">{money(forecast.value, forecast.complete)}</div><div className="label">Projected month-end metered cost</div></div>
      <div className={`stat-card${unattributed.length ? ' warn' : ''}`}><div className="value">{money(unattributedNet.value, unattributedNet.complete)}</div><div className="label">Unattributed cost · {unattributed.length} record(s)</div></div>
      <div className="stat-card"><div className="value">{assignedSeats.value === undefined ? 'Unavailable' : assignedSeats.value.toLocaleString()}</div><div className="label">Provider-reported Copilot seats</div></div>
    </div>

    <div className="cost-grid">
      <section className="panel">
        <h2>Cost exposure</h2>
        <dl className="cost-facts">
          <div><dt>Fixed license charges</dt><dd>{money(fixedLicense.value, fixedLicense.complete)}{fixedLicense.total === 0 ? ' — no license line items returned' : ''}</dd></div>
          <div><dt>Included allowances</dt><dd>Unavailable — provider allowance/pool data is not collected yet</dd></div>
          <div><dt>Metered usage</dt><dd>{money(metered.value, metered.complete)}</dd></div>
          <div><dt>Unclassified provider charges</dt><dd>{money(unclassified.value, unclassified.complete)}</dd></div>
          <div><dt>Configured budgets</dt><dd>{(budgets.data?.items ?? []).length} provider record(s)</dd></div>
          <div><dt>Forecast basis</dt><dd>{forecast.throughDate
            ? `Daily usage through ${forecast.throughDate}` : forecast.reason ?? 'Unavailable'}</dd></div>
        </dl>
      </section>
      <section className="panel">
        <h2>Attention required</h2>
        <ul className="attention-list">
          <li><strong>{capabilityProblems}</strong> workspace(s) have unavailable or unchecked billing capabilities.</li>
          <li><strong>{uncoveredProducts}</strong> observed product(s) have no matching configured budget.</li>
          <li><strong>{unattributed.length}</strong> usage record(s) cannot be attributed to a repository.</li>
          <li><strong>{coverage.reduce((sum, item) => sum + item.budgetsWithoutAlerts, 0)}</strong> budget(s) do not report enabled alerts.</li>
        </ul>
        <p><Link to="/costs/coverage">Review coverage and data quality →</Link></p>
      </section>
    </div>

    <div className="panel">
      <h2>How to read these numbers</h2>
      <p className="muted">
        Metered cost, fixed licenses, included allowances, and configured limits are different concepts.
        RepoWrangler does not combine them into a false total. Missing provider data is shown as unavailable,
        and forecasts are labeled as estimates.
      </p>
    </div>
  </>;
}
