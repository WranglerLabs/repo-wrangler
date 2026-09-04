/** Client-side inventory export (FR-014): JSON, CSV, and a Markdown report. */
import type { BudgetDto, RepositoryListItemDto, UsageItemDto } from '@repo-wrangler/contracts';

const COLUMNS: { key: keyof RepositoryListItemDto; label: string }[] = [
  { key: 'fullName', label: 'Repository' },
  { key: 'provider', label: 'Provider' },
  { key: 'visibility', label: 'Visibility' },
  { key: 'attentionLevel', label: 'Attention' },
  { key: 'defaultBranch', label: 'Default branch' },
  { key: 'defaultBranchStatus', label: 'Branch state' },
  { key: 'branchesAhead', label: 'Branches ahead' },
  { key: 'latestRunConclusion', label: 'Latest run' },
  { key: 'openChangeRequests', label: 'Open CRs' },
  { key: 'pushedAt', label: 'Last push' },
  { key: 'lastSyncedAt', label: 'Synced' },
  { key: 'isArchived', label: 'Archived' },
  { key: 'status', label: 'Status' },
];

function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

function download(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function csvCell(value: unknown): string {
  const raw = cell(value);
  const formulaSafe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return /[",\n]/.test(formulaSafe) ? `"${formulaSafe.replace(/"/g, '""')}"` : formulaSafe;
}

function exportRows(filename: string, columns: string[], rows: unknown[][]): void {
  const lines = [columns, ...rows].map((row) => row.map(csvCell).join(','));
  download(filename, lines.join('\n'), 'text/csv');
}

export function exportJson(repos: RepositoryListItemDto[]): void {
  download('repo-wrangler-inventory.json', JSON.stringify(repos, null, 2), 'application/json');
}

export function exportCsv(repos: RepositoryListItemDto[]): void {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const header = COLUMNS.map((c) => esc(c.label)).join(',');
  const rows = repos.map((r) => COLUMNS.map((c) => esc(cell(r[c.key]))).join(','));
  download('repo-wrangler-inventory.csv', [header, ...rows].join('\n'), 'text/csv');
}

export function exportUsageCsv(items: UsageItemDto[]): void {
  exportRows('repo-wrangler-usage.csv', [
    'Date', 'Provider', 'Organization', 'Repository', 'User', 'Product', 'SKU', 'Model',
    'Quantity', 'Unit', 'Unit price', 'Gross amount', 'Discount amount', 'Net amount',
    'Currency', 'Granularity', 'Observed',
  ], items.map((item) => [
    item.usageDate, item.provider, item.organizationName ?? item.workspaceSlug,
    item.repositoryFullName, item.userLogin, item.product, item.sku, item.model,
    item.netQuantity ?? item.quantity, item.unitType, item.pricePerUnit, item.grossAmount,
    item.discountAmount, item.netAmount, item.currency, item.periodGranularity, item.observedAt,
  ]));
}

export function exportBudgetsCsv(
  items: Array<BudgetDto & { workspaceSlug: string; provider: string }>,
): void {
  exportRows('repo-wrangler-budgets.csv', [
    'Provider', 'Organization', 'Budget ID', 'Type', 'Product', 'SKUs', 'Scope', 'Entity',
    'User', 'Amount', 'Unit', 'Alerts enabled', 'Alert recipients', 'Stop at limit',
    'Observed', 'Last successful synchronization',
  ], items.map((item) => [
    item.provider, item.workspaceSlug, item.externalId, item.budgetType, item.product,
    item.productSkus.join(';'), item.scopeType, item.scopeEntityName ?? item.scopeTarget,
    item.userLogin, item.amount, item.unit, item.alertEnabled,
    item.alertRecipients.join(';'), item.preventFurtherUsage, item.observedAt,
    item.lastSuccessfulSyncAt,
  ]));
}

export function exportMarkdown(repos: RepositoryListItemDto[]): void {
  const counts: Record<string, number> = {};
  for (const r of repos) counts[r.attentionLevel] = (counts[r.attentionLevel] ?? 0) + 1;
  const summary = Object.entries(counts)
    .map(([level, n]) => `- **${level}**: ${n}`)
    .join('\n');

  const header = `| ${COLUMNS.map((c) => c.label).join(' | ')} |`;
  const sep = `| ${COLUMNS.map(() => '---').join(' | ')} |`;
  const rows = repos.map(
    (r) => `| ${COLUMNS.map((c) => cell(r[c.key]).replace(/\|/g, '\\|')).join(' | ')} |`,
  );

  const md = [
    '# RepoWrangler estate report',
    '',
    `${repos.length} repositories.`,
    '',
    '## Attention summary',
    '',
    summary || '_No repositories._',
    '',
    '## Inventory',
    '',
    header,
    sep,
    ...rows,
    '',
  ].join('\n');

  download('repo-wrangler-report.md', md, 'text/markdown');
}
