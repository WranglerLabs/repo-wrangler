import { useMemo, useState } from 'react';
import type { BudgetDto, UsageItemDto } from '@repo-wrangler/contracts';
import { useEstateBudgets, useEstateUsage } from '../api/client';
import { CAPABILITY_LABELS } from '../lib/format';

export interface OptionalAggregate {
  value?: number;
  complete: boolean;
  known: number;
  total: number;
}

export function aggregate(items: UsageItemDto[], select: (item: UsageItemDto) => number | undefined): OptionalAggregate {
  const values = items.map(select);
  const known = values.filter((value): value is number => value !== undefined);
  return {
    value: known.length === 0 ? undefined : known.reduce((sum, value) => sum + value, 0),
    complete: known.length === values.length,
    known: known.length,
    total: values.length,
  };
}

function money(value: number | undefined, currency = 'USD') {
  return value === undefined ? 'Unavailable' : new Intl.NumberFormat(undefined,
    { style: 'currency', currency }).format(value);
}

function aggregateMoney(value: OptionalAggregate, currency = 'USD') {
  if (value.value === undefined) return 'Unavailable';
  const rendered = money(value.value, currency);
  return value.complete ? rendered : `At least ${rendered} (partial)`;
}

function aggregateNumber(value: OptionalAggregate) {
  if (value.value === undefined) return 'Unavailable';
  return value.complete ? value.value.toLocaleString() : `At least ${value.value.toLocaleString()} (partial)`;
}

function normalize(value: string | undefined) {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function isActionsMinute(item: UsageItemDto) {
  return normalize(item.product).includes('action') && normalize(item.unitType).includes('minute');
}

function isCopilot(item: UsageItemDto) {
  const category = normalize(`${item.product} ${item.sku}`);
  return category.includes('copilot') || category.includes('aicredit') || category.includes('premiumrequest');
}

function groupUsage(
  items: UsageItemDto[],
  keyFor: (item: UsageItemDto) => string,
  select: (item: UsageItemDto) => number | undefined,
) {
  const groups = new Map<string, UsageItemDto[]>();
  for (const item of items) {
    const key = keyFor(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.entries()].map(([key, rows]) => ({ key, rows, aggregate: aggregate(rows, select) }))
    .sort((left, right) => (right.aggregate.value ?? -Infinity) - (left.aggregate.value ?? -Infinity));
}

export function budgetApplies(
  budget: BudgetDto & { workspaceSlug: string; provider: string },
  item: UsageItemDto,
) {
  if (budget.provider !== item.provider || budget.workspaceSlug !== item.workspaceSlug) return false;
  const scope = normalize(budget.scopeType);
  if (scope.includes('repo')) {
    if (budget.repositoryId && item.repositoryId) {
      if (budget.repositoryId !== item.repositoryId) return false;
    } else {
      const entity = normalize(budget.scopeEntityName ?? budget.scopeTarget);
      const fullName = item.repositoryFullName ?? '';
      const shortName = fullName.split('/').at(-1);
      if (entity !== normalize(fullName) && entity !== normalize(shortName)) return false;
    }
  }
  if (scope.includes('user') && normalize(budget.scopeEntityName) !== normalize(item.userLogin)) return false;
  const productMatches = !budget.product || normalize(budget.product) === normalize(item.product)
    || normalize(item.product).includes(normalize(budget.product));
  const skuMatches = budget.productSkus.length === 0 || budget.productSkus.some((sku) => {
    const configured = normalize(sku);
    const observed = normalize(item.sku);
    return configured === observed || configured.includes(observed) || observed.includes(configured);
  });
  if (normalize(budget.budgetType).includes('sku')) return skuMatches;
  return productMatches || skuMatches;
}

export function Usage() {
  const usage = useEstateUsage();
  const budgets = useEstateBudgets();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [provider, setProvider] = useState('');
  const [organization, setOrganization] = useState('');
  const [repository, setRepository] = useState('');
  const [product, setProduct] = useState('');
  const [sku, setSku] = useState('');

  const allItems = usage.data?.items ?? [];
  const categoryFiltered = useMemo(() => allItems.filter((item) =>
    (!provider || item.provider === provider)
    && (!organization || item.workspaceSlug === organization)
    && (!repository || item.repositoryFullName === repository)
    && (!product || item.product === product)
    && (!sku || item.sku === sku)),
  [allItems, provider, organization, repository, product, sku]);
  const items = useMemo(() => categoryFiltered.filter((item) =>
    (!from || item.usageDate >= from) && (!to || item.usageDate <= to)),
  [categoryFiltered, from, to]);
  const currentMonthItems = categoryFiltered.filter((item) => item.usageDate >= monthStart && item.usageDate <= today);

  const values = (select: (item: UsageItemDto) => string | undefined) =>
    [...new Set(allItems.map(select).filter((value): value is string => Boolean(value)))].sort();
  const providers = values((item) => item.provider);
  const organizations = values((item) => item.workspaceSlug);
  const repositories = values((item) => item.repositoryFullName);
  const products = values((item) => item.product);
  const skus = values((item) => item.sku);

  const currentMonthNet = aggregate(currentMonthItems, (item) => item.netAmount);
  const selectedNet = aggregate(items, (item) => item.netAmount);
  const selectedGross = aggregate(items, (item) => item.grossAmount);
  const actions = items.filter(isActionsMinute);
  const actionsMinutes = aggregate(actions, (item) => item.netQuantity ?? item.quantity);
  const copilot = items.filter(isCopilot);
  const copilotNet = aggregate(copilot, (item) => item.netAmount);
  const copilotBySku = groupUsage(copilot, (item) => `${item.product} · ${item.sku}`,
    (item) => item.netQuantity ?? item.quantity);
  const unattributed = items.filter((item) => !item.repositoryFullName);
  const unattributedNet = aggregate(unattributed, (item) => item.netAmount);
  const byProduct = groupUsage(items, (item) => item.product, (item) => item.netAmount);
  const bySku = groupUsage(items, (item) => `${item.product} · ${item.sku}`, (item) => item.netAmount);
  const byOrganization = groupUsage(items, (item) => item.workspaceSlug, (item) => item.netAmount);
  const repositoryCosts = groupUsage(
    items.filter((item) => Boolean(item.repositoryFullName)),
    (item) => item.repositoryFullName!,
    (item) => item.netAmount,
  );
  const repositoryActions = groupUsage(
    actions.filter((item) => Boolean(item.repositoryFullName)),
    (item) => item.repositoryFullName!,
    (item) => item.netQuantity ?? item.quantity,
  );
  const trends = groupUsage(items, (item) => item.usageDate, (item) => item.netAmount)
    .sort((left, right) => left.key.localeCompare(right.key));
  const monthlyTrends = groupUsage(items, (item) => item.usageDate.slice(0, 7),
    (item) => item.netAmount).sort((left, right) => left.key.localeCompare(right.key));

  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const elapsedDays = Math.max(1, now.getUTCDate());
  const comparisons = (budgets.data?.items ?? []).map((budget) => {
    const applicable = currentMonthItems.filter((item) => budgetApplies(budget, item));
    const monetary = budget.unit === 'USD';
    const actual = aggregate(applicable, (item) => monetary ? item.netAmount : undefined);
    const percent = monetary && budget.amount !== undefined && actual.value !== undefined && budget.amount !== 0
      ? actual.value / budget.amount * 100 : undefined;
    const projected = actual.value === undefined ? undefined : actual.value / elapsedDays * daysInMonth;
    return { budget, actual, percent, projected };
  });

  return (
    <>
      <h1 className="page-title">Actual Usage</h1>
      <p className="page-subtitle">
        Provider-reported consumption, attribution, cost, trends, and configured-budget comparisons.
        Missing provider values remain unavailable and are never converted to zero.
      </p>
      <div className="filter-bar">
        <input type="date" aria-label="Usage from" value={from} onChange={(event) => setFrom(event.target.value)} />
        <input type="date" aria-label="Usage to" value={to} onChange={(event) => setTo(event.target.value)} />
        <select value={provider} onChange={(event) => setProvider(event.target.value)}><option value="">All providers</option>{providers.map((value) => <option key={value}>{value}</option>)}</select>
        <select value={organization} onChange={(event) => setOrganization(event.target.value)}><option value="">All organizations</option>{organizations.map((value) => <option key={value}>{value}</option>)}</select>
        <select value={repository} onChange={(event) => setRepository(event.target.value)}><option value="">All repositories</option>{repositories.map((value) => <option key={value}>{value}</option>)}</select>
        <select value={product} onChange={(event) => setProduct(event.target.value)}><option value="">All products</option>{products.map((value) => <option key={value}>{value}</option>)}</select>
        <select value={sku} onChange={(event) => setSku(event.target.value)}><option value="">All SKUs</option>{skus.map((value) => <option key={value}>{value}</option>)}</select>
      </div>

      <div className="summary-strip">
        <div className="stat-card"><span>Current-month net cost</span><strong>{aggregateMoney(currentMonthNet)}</strong></div>
        <div className="stat-card"><span>Selected gross / net</span><strong>{aggregateMoney(selectedGross)} / {aggregateMoney(selectedNet)}</strong></div>
        <div className="stat-card"><span>Actions minutes</span><strong>{aggregateNumber(actionsMinutes)}</strong></div>
        <div className="stat-card"><span>Copilot / AI net cost</span><strong>{aggregateMoney(copilotNet)}</strong></div>
        <div className="stat-card"><span>Unattributed usage</span><strong>{unattributed.length} records · {aggregateMoney(unattributedNet)}</strong></div>
      </div>

      {usage.data?.capabilities.map((item) => (
        <div className="panel" key={`${item.provider}:${item.workspaceSlug}`}>
          <span className="capability">{item.workspaceSlug}: {CAPABILITY_LABELS[item.state] ?? item.state}</span>
          {item.errorCode ? ` — ${item.errorCode}` : ''}{item.detail ? ` — ${item.detail}` : ''}
          {' '}· checked {item.checkedAt}{item.lastSuccessAt ? ` · last successful ${item.lastSuccessAt}` : ''}
        </div>
      ))}

      <div className="panel table-scroll">
        <h2>Top repositories</h2>
        <h3>By net cost</h3>
        <table className="data"><thead><tr><th>Repository</th><th>Net cost</th><th>Actions minutes</th></tr></thead>
          <tbody>{repositoryCosts.slice(0, 20).map((row) => {
            const minuteRow = repositoryActions.find((candidate) => candidate.key === row.key);
            return <tr key={row.key}><td className="mono">{row.key}</td><td>{aggregateMoney(row.aggregate)}</td><td>{minuteRow ? aggregateNumber(minuteRow.aggregate) : 'Unavailable'}</td></tr>;
          })}</tbody>
        </table>
        <h3>By GitHub Actions minutes</h3>
        <table className="data"><thead><tr><th>Repository</th><th>Actions minutes</th><th>Net cost</th></tr></thead>
          <tbody>{repositoryActions.slice(0, 20).map((row) => {
            const costRow = repositoryCosts.find((candidate) => candidate.key === row.key);
            return <tr key={row.key}><td className="mono">{row.key}</td><td>{aggregateNumber(row.aggregate)}</td><td>{costRow ? aggregateMoney(costRow.aggregate) : 'Unavailable'}</td></tr>;
          })}</tbody>
        </table>
      </div>

      <div className="panel table-scroll">
        <h2>Products and SKUs</h2>
        <h3>By organization</h3>
        <table className="data"><thead><tr><th>Organization</th><th>Net cost</th><th>Usage records</th></tr></thead>
          <tbody>{byOrganization.map((row) => <tr key={row.key}><td>{row.key}</td><td>{aggregateMoney(row.aggregate)}</td><td>{row.rows.length}</td></tr>)}</tbody>
        </table>
        <h3>By product</h3>
        <table className="data"><thead><tr><th>Product</th><th>Net cost</th><th>Usage records</th></tr></thead>
          <tbody>{byProduct.map((row) => <tr key={row.key}><td>{row.key}</td><td>{aggregateMoney(row.aggregate)}</td><td>{row.rows.length}</td></tr>)}</tbody>
        </table>
        <table className="data"><thead><tr><th>SKU</th><th>Quantity</th><th>Unit</th><th>Net cost</th><th>Usage records</th></tr></thead>
          <tbody>{bySku.map((row) => <tr key={row.key}><td>{row.key}</td>
            <td>{aggregateNumber(aggregate(row.rows, (item) => item.netQuantity ?? item.quantity))}</td>
            <td>{row.rows[0]?.unitType ?? 'Unavailable'}</td><td>{aggregateMoney(row.aggregate)}</td><td>{row.rows.length}</td></tr>)}</tbody>
        </table>
      </div>

      <div className="panel table-scroll">
        <h2>Copilot, AI credits, and premium requests</h2>
        <table className="data"><thead><tr><th>Product / SKU</th><th>Quantity</th><th>Unit</th><th>Net cost</th></tr></thead>
          <tbody>{copilotBySku.map((row) => <tr key={row.key}>
            <td>{row.key}</td><td>{aggregateNumber(row.aggregate)}</td>
            <td>{row.rows[0]?.unitType ?? 'Unavailable'}</td>
            <td>{aggregateMoney(aggregate(row.rows, (item) => item.netAmount))}</td>
          </tr>)}{copilotBySku.length === 0 && <tr><td colSpan={4}>No Copilot, AI-credit, or premium-request usage was returned for this selection. This does not mean the organization lacks a Copilot subscription.</td></tr>}</tbody>
        </table>
      </div>

      <div className="panel table-scroll">
        <h2>Daily and monthly trend</h2>
        <h3>Monthly</h3>
        <table className="data"><thead><tr><th>Month</th><th>Net cost</th><th>Records</th></tr></thead>
          <tbody>{monthlyTrends.map((row) => <tr key={row.key}><td>{row.key}</td><td>{aggregateMoney(row.aggregate)}</td><td>{row.rows.length}</td></tr>)}</tbody>
        </table>
        <h3>Daily / provider periods</h3>
        <table className="data"><thead><tr><th>Period</th><th>Net cost</th><th>Records</th></tr></thead>
          <tbody>{trends.map((row) => <tr key={row.key}><td>{row.key}{row.rows.some((item) => item.periodGranularity === 'month') ? ' (monthly aggregate present)' : ''}</td><td>{aggregateMoney(row.aggregate)}</td><td>{row.rows.length}</td></tr>)}</tbody>
        </table>
      </div>

      <div className="panel table-scroll">
        <h2>Budget versus current-month actual</h2>
        <table className="data"><thead><tr><th>Organization</th><th>Budget source</th><th>Product / SKUs</th><th>Budget</th><th>Actual</th><th>Consumed</th><th>State</th><th>Projected</th></tr></thead>
          <tbody>{comparisons.map(({ budget, actual, percent, projected }) => <tr key={`${budget.workspaceSlug}:${budget.externalId}`}>
            <td>{budget.workspaceSlug}</td>
            <td>{budget.scopeType ?? 'broader scope'}{budget.scopeEntityName ? ` · ${budget.scopeEntityName}` : ''}</td>
            <td>{budget.product ?? 'Provider-defined'}{budget.productSkus.length ? ` · ${budget.productSkus.join(', ')}` : ''}</td>
            <td>{budget.amount === undefined ? 'Unavailable'
              : budget.unit === 'USD' ? money(budget.amount, 'USD')
                : `${budget.amount} (provider unit not reported)`}</td>
            <td>{budget.unit === 'USD' ? aggregateMoney(actual, 'USD') : 'Unavailable'}</td>
            <td>{percent === undefined ? 'Unavailable' : `${actual.complete ? '' : 'At least '}${percent.toFixed(1)}%`}</td>
            <td>{percent === undefined ? 'Unavailable' : percent >= 100 ? 'Exceeded' : percent >= 80 ? 'Approaching' : 'Within budget'}</td>
            <td>{projected === undefined ? 'Unavailable' : `${actual.complete ? '' : 'At least '}${money(projected, 'USD')}`}</td>
          </tr>)}</tbody>
        </table>
      </div>

      <div className="panel table-scroll">
        <h2>Usage detail</h2>
        <table className="data"><thead><tr>
          <th>Date</th><th>Organization</th><th>Repository / user</th><th>Product</th><th>SKU</th>
          <th>Quantity</th><th>Unit price</th><th>Gross</th><th>Discount</th><th>Net</th><th>Observed</th>
        </tr></thead><tbody>{items.map((item, index) => <tr key={`${item.workspaceSlug}:${item.usageDate}:${item.sku}:${index}`}>
          <td>{item.usageDate}{item.periodGranularity === 'month' ? ' (monthly)' : ''}</td>
          <td>{item.organizationName ?? item.workspaceSlug}</td>
          <td>{item.repositoryFullName ?? (item.userLogin ? `User: ${item.userLogin}` : 'Unattributed')}</td>
          <td>{item.product}</td><td>{item.sku}{item.model ? ` · ${item.model}` : ''}</td>
          <td>{item.netQuantity ?? item.quantity ?? 'Unavailable'} {item.unitType ?? ''}</td>
          <td>{money(item.pricePerUnit, item.currency)}</td>
          <td>{money(item.grossAmount, item.currency)}</td><td>{money(item.discountAmount, item.currency)}</td>
          <td>{money(item.netAmount, item.currency)}</td><td>{item.observedAt}</td>
        </tr>)}</tbody></table>
      </div>
    </>
  );
}
