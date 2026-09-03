import { useMemo, useState } from 'react';
import type { BudgetDto } from '@repo-wrangler/contracts';
import { useEstateBudgets } from '../api/client';
import { CAPABILITY_LABELS } from '../lib/format';

function normalize(value: string | undefined) {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function isCopilotBudget(budget: Pick<BudgetDto, 'product' | 'productSkus'>) {
  const category = normalize(`${budget.product ?? ''} ${budget.productSkus.join(' ')}`);
  return category.includes('copilot') || category.includes('aicredit')
    || category.includes('premiumrequest');
}

export function Budgets() {
  const budgets = useEstateBudgets();
  const [provider, setProvider] = useState('');
  const [workspace, setWorkspace] = useState('');
  const [repository, setRepository] = useState('');
  const [product, setProduct] = useState('');
  const [sku, setSku] = useState('');
  const [scope, setScope] = useState('');
  const [alertState, setAlertState] = useState('');
  const [stopState, setStopState] = useState('');
  const items = useMemo(() => (budgets.data?.items ?? []).filter((item) =>
    (!provider || item.provider === provider) && (!workspace || item.workspaceSlug === workspace)
    && (!repository || (item.scopeType?.toLowerCase().includes('repo')
      && item.scopeEntityName === repository))
    && (!product || item.product === product) && (!sku || item.productSkus.includes(sku))
    && (!scope || item.scopeType === scope)
    && (!alertState || String(item.alertEnabled) === alertState)
    && (!stopState || String(item.preventFurtherUsage) === stopState)),
  [budgets.data, provider, workspace, repository, product, sku, scope, alertState, stopState]);
  const values = (key: 'workspaceSlug' | 'product' | 'scopeType') => [...new Set(
    (budgets.data?.items ?? []).map((item) => item[key]).filter((v): v is string => Boolean(v)),
  )].sort();
  const providers = [...new Set((budgets.data?.items ?? []).map((item) => item.provider))].sort();
  const repositories = [...new Set((budgets.data?.items ?? [])
    .filter((item) => item.scopeType?.toLowerCase().includes('repo'))
    .map((item) => item.scopeEntityName).filter((v): v is string => Boolean(v)))].sort();
  const skus = [...new Set((budgets.data?.items ?? []).flatMap((item) => item.productSkus))].sort();
  const copilotCapabilities = (budgets.data?.copilotCapabilities ?? []).filter((item) =>
    (!provider || item.provider === provider) && (!workspace || item.workspaceSlug === workspace));
  const copilotSubscriptions = budgets.data?.copilotSubscriptions ?? [];
  const allBudgetItems = budgets.data?.items ?? [];
  return <>
    <h1 className="page-title">Budget Settings</h1>
    <p className="page-subtitle">Configured provider limits, scopes, products, SKUs, alerts, and hard-stop behavior. Actual consumption is shown separately.</p>
    <div className="filter-bar">
      <select value={provider} onChange={(e) => setProvider(e.target.value)}><option value="">All providers</option>{providers.map((v) => <option key={v}>{v}</option>)}</select>
      <select value={workspace} onChange={(e) => setWorkspace(e.target.value)}><option value="">All organizations</option>{values('workspaceSlug').map((v) => <option key={v}>{v}</option>)}</select>
      <select value={repository} onChange={(e) => setRepository(e.target.value)}><option value="">All repositories</option>{repositories.map((v) => <option key={v}>{v}</option>)}</select>
      <select value={product} onChange={(e) => setProduct(e.target.value)}><option value="">All products</option>{values('product').map((v) => <option key={v}>{v}</option>)}</select>
      <select value={sku} onChange={(e) => setSku(e.target.value)}><option value="">All SKUs</option>{skus.map((v) => <option key={v}>{v}</option>)}</select>
      <select value={scope} onChange={(e) => setScope(e.target.value)}><option value="">All scopes</option>{values('scopeType').map((v) => <option key={v}>{v}</option>)}</select>
      <select value={alertState} onChange={(e) => setAlertState(e.target.value)}><option value="">Any alert state</option><option value="true">Alerts enabled</option><option value="false">Alerts disabled</option></select>
      <select value={stopState} onChange={(e) => setStopState(e.target.value)}><option value="">Any limit behavior</option><option value="true">Stops at limit</option><option value="false">Does not stop</option></select>
    </div>
    {budgets.data && budgets.data.state !== 'available' && <div className="panel"><span className="capability">{CAPABILITY_LABELS[budgets.data.state] ?? budgets.data.state}</span></div>}
    {budgets.data?.capabilities?.filter((item) => item.state !== 'available').map((item) =>
      <div className="panel" key={`${item.provider}:${item.workspaceSlug}`}><span className="capability">{item.workspaceSlug}: {CAPABILITY_LABELS[item.state] ?? item.state}</span>{item.errorCode ? ` — ${item.errorCode}` : ''}{item.detail ? ` — ${item.detail}` : ''} · checked {item.checkedAt}{item.lastSuccessAt ? ` · last successful ${item.lastSuccessAt}` : ''}</div>)}
    <div className="panel table-scroll">
      <h2>Copilot subscriptions and metered budgets</h2>
      <p className="capability">
        A Copilot Business or Enterprise subscription is organization-wide, but it is not itself a spending budget.
        GitHub returns subscription seats and policies separately from configured AI-credit or premium-request budgets.
      </p>
      <table className="data"><thead><tr>
        <th>Organization</th><th>Provider</th><th>Subscription plan</th><th>Seats</th>
        <th>Seat assignment</th><th>Policies</th><th>Subscription capability</th><th>Metered Copilot / AI budget</th>
      </tr></thead><tbody>
        {copilotCapabilities.map((capability) => {
          const subscription = copilotSubscriptions.find((item) => item.provider === capability.provider
            && item.workspaceSlug === capability.workspaceSlug);
          const meteredBudgets = allBudgetItems.filter((item) => item.provider === capability.provider
            && item.workspaceSlug === capability.workspaceSlug && isCopilotBudget(item));
          const budgetCapability = budgets.data?.capabilities?.find((item) => item.provider === capability.provider
            && item.workspaceSlug === capability.workspaceSlug);
          return <tr key={`${capability.provider}:${capability.workspaceSlug}`}>
            <td>{capability.workspaceSlug}</td><td>{capability.provider}</td>
            <td>{subscription?.planType ?? 'Unavailable'}</td>
            <td>{subscription ? `${subscription.totalSeats} total${subscription.activeThisCycle === undefined ? '' : ` · ${subscription.activeThisCycle} active this cycle`}` : 'Unavailable'}</td>
            <td>{subscription?.seatManagementSetting ?? 'Unavailable'}</td>
            <td>{subscription ? `IDE chat ${subscription.ideChat ?? 'unreported'} · platform chat ${subscription.platformChat ?? 'unreported'} · CLI ${subscription.cli ?? 'unreported'} · public code ${subscription.publicCodeSuggestions ?? 'unreported'}` : 'Unavailable'}</td>
            <td>{CAPABILITY_LABELS[capability.state] ?? capability.state}{capability.errorCode ? ` · ${capability.errorCode}` : ''}<br />checked {capability.checkedAt}</td>
            <td>{meteredBudgets.length
              ? `${meteredBudgets.length} configured · ${meteredBudgets.flatMap((item) => item.productSkus).join(', ')}`
              : budgetCapability?.state === 'available'
                ? 'No configured metered Copilot or AI-credit budget returned by GitHub'
                : 'Unavailable'}</td>
          </tr>;
        })}
        {copilotCapabilities.length === 0 && <tr><td colSpan={8}>Copilot subscription capability has not been checked yet. Run a billing synchronization.</td></tr>}
      </tbody></table>
    </div>
    <div className="panel table-scroll"><table className="data"><thead><tr>
      <th>Organization</th><th>Provider</th><th>Scope / entity</th><th>Budget type</th>
      <th>Product</th><th>SKUs</th><th>Monthly budget</th><th>Alerts / recipients</th>
      <th>Stop at limit</th><th>Last successful check</th><th>Capability</th>
    </tr></thead><tbody>{items.map((budget) => <tr key={`${budget.workspaceSlug}:${budget.externalId}`}>
      <td>{budget.workspaceSlug}</td><td>{budget.provider}</td>
      <td>{budget.scopeType ?? '—'}{budget.scopeEntityName ? ` · ${budget.scopeEntityName}` : ''}</td>
      <td>{budget.budgetType ?? '—'}</td><td>{budget.product ?? '—'}</td>
      <td>{budget.productSkus.length ? budget.productSkus.join(', ') : '—'}</td>
      <td>{budget.amount === undefined ? '—' : `${budget.amount} ${budget.unit ?? '(provider unit not reported)'}`}</td>
      <td>{budget.alertEnabled === undefined ? '—' : budget.alertEnabled ? `Enabled${budget.alertRecipients.length ? ` · ${budget.alertRecipients.join(', ')}` : ''}` : 'Disabled'}</td>
      <td>{budget.preventFurtherUsage ? 'Yes' : 'No'}</td>
      <td>{budget.lastSuccessfulSyncAt ?? budget.observedAt}</td>
      <td>{(() => {
        const capability = budgets.data?.capabilities?.find((item) =>
          item.provider === budget.provider && item.workspaceSlug === budget.workspaceSlug);
        if (!capability) return 'Not checked';
        return `${CAPABILITY_LABELS[capability.state] ?? capability.state}${capability.errorCode ? ` · ${capability.errorCode}` : ''}`;
      })()}</td>
    </tr>)}{items.length === 0 && <tr><td colSpan={11}>No configured budgets match this selection. Unavailable provider data is reported above and is not treated as zero.</td></tr>}</tbody></table></div>
  </>;
}
