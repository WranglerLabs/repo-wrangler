import { useEstateBudgets } from '../api/client';
import { CAPABILITY_LABELS } from '../lib/format';

export function Budgets() {
  const budgets = useEstateBudgets();

  return (
    <>
      <h1 className="page-title">Budgets &amp; Usage</h1>
      <p className="page-subtitle">
        Provider budgets and alert state per workspace. Missing access is shown as a capability
        state — never as a false zero.
      </p>

      {budgets.data && budgets.data.state !== 'available' && (
        <div className="panel">
          <span className="capability">
            {CAPABILITY_LABELS[budgets.data.state] ?? budgets.data.state}
          </span>
          <p className="muted" style={{ marginTop: 8 }}>
            {budgets.data.state === 'not_configured'
              ? 'No budgets observed yet. Budgets appear after the daily billing sync for workspaces where the connection is authorized to read them.'
              : 'Budget data is not currently readable for this estate.'}
          </p>
        </div>
      )}

      {budgets.data?.state === 'available' && (
        <div className="panel table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>Workspace</th>
                <th>Product</th>
                <th>Scope</th>
                <th>Amount</th>
                <th>Alert state</th>
                <th>Stop at limit</th>
              </tr>
            </thead>
            <tbody>
              {budgets.data.items?.map((budget, index) => (
                <tr key={index}>
                  <td>
                    {budget.workspaceSlug}
                    <span className="badge outline" style={{ marginLeft: 6 }}>
                      {budget.provider}
                    </span>
                  </td>
                  <td>{budget.product ?? '—'}</td>
                  <td>
                    {budget.scopeType ?? '—'}
                    {budget.scopeTarget ? ` · ${budget.scopeTarget}` : ''}
                  </td>
                  <td>
                    {budget.amount !== undefined ? `${budget.amount} ${budget.unit ?? ''}` : '—'}
                  </td>
                  <td>{budget.alertStatus ?? '—'}</td>
                  <td>
                    {budget.preventFurtherUsage ? (
                      <span className="badge high">yes</span>
                    ) : (
                      <span className="badge healthy">no</span>
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
