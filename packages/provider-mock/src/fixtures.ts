import type {
  AttentionItemDto,
  OverviewDto,
  PlatformHealthDto,
  RepositoryDetailDto,
  RepositoryListItemDto,
  WorkspaceDto,
} from '@repo-wrangler/contracts';
import type {
  BranchSnapshot,
  ChangeRequestSnapshot,
  PipelineRunSnapshot,
  RepositoryHealthInput,
  SecurityFindingSnapshot,
} from '@repo-wrangler/domain';
import {
  capabilityAvailable,
  capabilityUnavailable,
  evaluateDefaultBranchStatus,
  evaluateRepositoryHealth,
} from '@repo-wrangler/domain';

/**
 * Synthetic demo estate. All attention levels are computed by the real
 * domain health engine so demo mode exercises the same rules as production.
 * No real organizations, repositories, or people appear here.
 */

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

interface DemoRepo {
  id: string;
  workspaceSlug: string;
  name: string;
  description?: string;
  visibility: 'public' | 'private';
  isArchived?: boolean;
  isFork?: boolean;
  defaultBranch: string;
  pushedDaysAgo: number;
  language?: string;
  topics?: string[];
  license?: string;
  branches: BranchSnapshot[];
  latestRun?: PipelineRunSnapshot;
  openChangeRequests: ChangeRequestSnapshot[];
  securityFindings?: SecurityFindingSnapshot[];
  securityUnavailable?: boolean;
  firstSeenDaysAgo?: number;
  status?: 'active' | 'inaccessible';
}

function branch(overrides: Partial<BranchSnapshot> & { name: string }): BranchSnapshot {
  return {
    isDefault: false,
    isProtected: false,
    comparisonStatus: 'unknown',
    excluded: false,
    ...overrides,
  };
}

function run(
  overrides: Partial<PipelineRunSnapshot> & { externalId: string },
): PipelineRunSnapshot {
  return { status: 'completed', conclusion: 'success', ...overrides };
}

const DEMO_REPOS: DemoRepo[] = [
  {
    id: 'demo-r1',
    workspaceSlug: 'saguaro-systems',
    name: 'trailhead-api',
    description: 'Core REST API for the Trailhead platform.',
    visibility: 'private',
    defaultBranch: 'main',
    pushedDaysAgo: 0,
    language: 'TypeScript',
    topics: ['api', 'production'],
    license: 'Apache-2.0',
    branches: [
      branch({ name: 'main', isDefault: true, isProtected: true, comparisonStatus: 'identical' }),
      branch({
        name: 'feature/rate-limits',
        comparisonStatus: 'ahead',
        aheadBy: 4,
        behindBy: 0,
        openChangeRequestNumber: 218,
        headCommittedAt: daysAgo(1),
      }),
    ],
    latestRun: run({
      externalId: 'run-1',
      name: 'ci',
      conclusion: 'failure',
      branch: 'main',
      runStartedAt: daysAgo(0.1),
      durationSeconds: 412,
      url: 'https://github.com/saguaro-systems/trailhead-api/actions',
    }),
    openChangeRequests: [
      {
        number: 218,
        title: 'Add per-tenant rate limits',
        author: 'mesquite-dev',
        isDraft: false,
        state: 'open',
        baseRef: 'main',
        headRef: 'feature/rate-limits',
        requestedReviewers: ['ocotillo-lee'],
        mergeableState: 'clean',
        checksStatus: 'failing',
        createdAt: daysAgo(2),
        updatedAt: daysAgo(0.5),
      },
    ],
    securityFindings: [],
  },
  {
    id: 'demo-r2',
    workspaceSlug: 'saguaro-systems',
    name: 'trailhead-web',
    description: 'Customer-facing web application.',
    visibility: 'private',
    defaultBranch: 'main',
    pushedDaysAgo: 1,
    language: 'TypeScript',
    topics: ['frontend', 'production'],
    branches: [
      branch({ name: 'main', isDefault: true, isProtected: true, comparisonStatus: 'identical' }),
    ],
    latestRun: run({ externalId: 'run-2', name: 'ci', branch: 'main', runStartedAt: daysAgo(1) }),
    openChangeRequests: [],
    securityFindings: [
      {
        externalId: 'sec-1',
        category: 'secret_scanning',
        state: 'open',
        ruleId: 'cloud_provider_key',
        summary: 'Cloud provider access key detected in repository history.',
        url: 'https://github.com/saguaro-systems/trailhead-web/security',
        createdAt: daysAgo(0.3),
      },
    ],
  },
  {
    id: 'demo-r3',
    workspaceSlug: 'saguaro-systems',
    name: 'infra-modules',
    description: 'Terraform modules for platform infrastructure.',
    visibility: 'private',
    defaultBranch: 'main',
    pushedDaysAgo: 6,
    language: 'HCL',
    topics: ['infrastructure'],
    branches: [
      branch({ name: 'main', isDefault: true, isProtected: true, comparisonStatus: 'identical' }),
      branch({
        name: 'spike/vnet-redesign',
        comparisonStatus: 'ahead',
        aheadBy: 19,
        behindBy: 0,
        headCommittedAt: daysAgo(12),
      }),
    ],
    latestRun: run({ externalId: 'run-3', name: 'validate', branch: 'main', runStartedAt: daysAgo(6) }),
    openChangeRequests: [],
    securityFindings: [],
  },
  {
    id: 'demo-r4',
    workspaceSlug: 'saguaro-systems',
    name: 'legacy-billing',
    description: 'Legacy billing integration, migration pending.',
    visibility: 'private',
    defaultBranch: 'master',
    pushedDaysAgo: 240,
    language: 'C#',
    branches: [
      branch({ name: 'master', isDefault: true, comparisonStatus: 'identical' }),
      branch({
        name: 'hotfix/2019-rounding',
        comparisonStatus: 'diverged',
        aheadBy: 3,
        behindBy: 88,
        headCommittedAt: daysAgo(410),
      }),
    ],
    openChangeRequests: [
      {
        number: 77,
        title: 'Migrate invoice export to new API',
        author: 'cholla-ops',
        isDraft: false,
        state: 'open',
        baseRef: 'master',
        headRef: 'feature/invoice-export',
        requestedReviewers: [],
        mergeableState: 'dirty',
        checksStatus: 'unknown',
        createdAt: daysAgo(60),
        updatedAt: daysAgo(45),
      },
    ],
    securityFindings: [
      {
        externalId: 'sec-2',
        category: 'dependency',
        severity: 'high',
        state: 'open',
        ruleId: 'GHSA-demo-0001',
        summary: 'Vulnerable JSON parser dependency.',
        createdAt: daysAgo(30),
      },
    ],
  },
  {
    id: 'demo-r5',
    workspaceSlug: 'copperline-labs',
    name: 'kiln-scheduler',
    description: 'Batch job scheduler experiments.',
    visibility: 'public',
    defaultBranch: 'main',
    pushedDaysAgo: 2,
    language: 'Go',
    topics: ['lab'],
    license: 'MIT',
    branches: [
      branch({ name: 'main', isDefault: true, comparisonStatus: 'identical' }),
      branch({
        name: 'dependabot/go_modules/yaml-3.0.1',
        comparisonStatus: 'ahead',
        aheadBy: 1,
        behindBy: 0,
        excluded: true,
        excludedReason: 'Matched instance branch exclusion pattern.',
      }),
    ],
    latestRun: run({ externalId: 'run-5', name: 'test', branch: 'main', runStartedAt: daysAgo(2) }),
    openChangeRequests: [],
    securityUnavailable: true,
  },
  {
    id: 'demo-r6',
    workspaceSlug: 'copperline-labs',
    name: 'forge-cli',
    description: 'Internal developer CLI.',
    visibility: 'public',
    defaultBranch: 'main',
    pushedDaysAgo: 3,
    language: 'Rust',
    license: 'Apache-2.0',
    branches: [
      branch({ name: 'main', isDefault: true, comparisonStatus: 'identical' }),
    ],
    latestRun: run({
      externalId: 'run-6',
      name: 'release',
      conclusion: 'cancelled',
      branch: 'main',
      runStartedAt: daysAgo(3),
    }),
    openChangeRequests: [],
    securityFindings: [],
    firstSeenDaysAgo: 2,
  },
  {
    id: 'demo-r7',
    workspaceSlug: 'copperline-labs',
    name: 'docs-site',
    description: 'Documentation for Copperline tooling.',
    visibility: 'public',
    isArchived: true,
    defaultBranch: 'main',
    pushedDaysAgo: 300,
    language: 'Markdown',
    branches: [branch({ name: 'main', isDefault: true, comparisonStatus: 'identical' })],
    openChangeRequests: [],
    securityFindings: [],
  },
  {
    id: 'demo-r8',
    workspaceSlug: 'high-desert',
    name: 'ranch-inventory',
    description: 'Personal inventory tracker.',
    visibility: 'private',
    defaultBranch: 'main',
    pushedDaysAgo: 9,
    language: 'Python',
    branches: [
      branch({ name: 'main', isDefault: true, comparisonStatus: 'identical' }),
      branch({
        name: 'feature/barcode-scan',
        comparisonStatus: 'ahead',
        aheadBy: 7,
        behindBy: 0,
        openChangeRequestNumber: 12,
        headCommittedAt: daysAgo(9),
      }),
    ],
    latestRun: run({ externalId: 'run-8', name: 'ci', branch: 'main', runStartedAt: daysAgo(9) }),
    openChangeRequests: [
      {
        number: 12,
        title: 'Add barcode scanning',
        author: 'high-desert',
        isDraft: true,
        state: 'open',
        baseRef: 'main',
        headRef: 'feature/barcode-scan',
        requestedReviewers: [],
        mergeableState: 'clean',
        checksStatus: 'passing',
        createdAt: daysAgo(10),
        updatedAt: daysAgo(9),
      },
    ],
    securityFindings: [],
    firstSeenDaysAgo: 5,
  },
  {
    id: 'demo-r9',
    workspaceSlug: 'high-desert',
    name: 'old-blog',
    description: 'Retired blog source.',
    visibility: 'public',
    defaultBranch: 'main',
    pushedDaysAgo: 500,
    language: 'JavaScript',
    branches: [branch({ name: 'main', isDefault: true, comparisonStatus: 'identical' })],
    openChangeRequests: [],
    securityFindings: [],
    status: 'inaccessible',
  },
];

const WORKSPACES: Array<{
  id: string;
  slug: string;
  displayName: string;
  kind: 'organization' | 'user';
}> = [
  { id: 'demo-w1', slug: 'saguaro-systems', displayName: 'Saguaro Systems', kind: 'organization' },
  { id: 'demo-w2', slug: 'copperline-labs', displayName: 'Copperline Labs', kind: 'organization' },
  { id: 'demo-w3', slug: 'high-desert', displayName: 'high-desert', kind: 'user' },
];

function healthInput(repo: DemoRepo): RepositoryHealthInput {
  return {
    repository: {
      externalId: repo.id,
      name: repo.name,
      fullName: `${repo.workspaceSlug}/${repo.name}`,
      isArchived: repo.isArchived ?? false,
      isFork: repo.isFork ?? false,
      isDisabled: false,
      isTemplate: false,
      defaultBranch: repo.defaultBranch,
      pushedAt: daysAgo(repo.pushedDaysAgo),
      topics: repo.topics ?? [],
      visibility: repo.visibility,
      primaryLanguage: repo.language,
      licenseSpdx: repo.license,
      description: repo.description,
      url: `https://github.com/${repo.workspaceSlug}/${repo.name}`,
    },
    branches: repo.branches,
    latestDefaultBranchRun: repo.latestRun,
    openChangeRequests: repo.openChangeRequests,
    securityFindings: repo.securityUnavailable
      ? capabilityUnavailable('not_configured')
      : capabilityAvailable(repo.securityFindings ?? []),
  };
}

function toListItem(repo: DemoRepo): RepositoryListItemDto {
  const health = evaluateRepositoryHealth(healthInput(repo));
  const branchEval = evaluateDefaultBranchStatus(repo.branches);
  return {
    id: repo.id,
    provider: 'github',
    workspaceSlug: repo.workspaceSlug,
    name: repo.name,
    fullName: `${repo.workspaceSlug}/${repo.name}`,
    url: `https://github.com/${repo.workspaceSlug}/${repo.name}`,
    visibility: repo.visibility,
    isArchived: repo.isArchived ?? false,
    defaultBranch: repo.defaultBranch,
    defaultBranchStatus: branchEval.status,
    branchesAhead: repo.branches.filter(
      (b) => !b.excluded && (b.comparisonStatus === 'ahead' || b.comparisonStatus === 'diverged'),
    ).length,
    latestRunConclusion: repo.latestRun?.conclusion,
    latestRunAt: repo.latestRun?.runStartedAt,
    openChangeRequests: repo.openChangeRequests.filter((cr) => cr.state === 'open').length,
    attentionLevel: health.level,
    primaryLanguage: repo.language,
    pushedAt: daysAgo(repo.pushedDaysAgo),
    lastSyncedAt: daysAgo(0.01),
    status: repo.status ?? 'active',
  };
}

export function demoRepositories(): RepositoryListItemDto[] {
  return DEMO_REPOS.map(toListItem);
}

export function demoRepositoryDetail(id: string): RepositoryDetailDto | undefined {
  const repo = DEMO_REPOS.find((r) => r.id === id);
  if (!repo) return undefined;
  const health = evaluateRepositoryHealth(healthInput(repo));
  return {
    repository: {
      ...toListItem(repo),
      description: repo.description,
      topics: repo.topics ?? [],
      licenseSpdx: repo.license,
      isFork: repo.isFork ?? false,
    },
    healthFindings: health.findings,
    branches: repo.branches.map((b) => ({
      name: b.name,
      headCommittedAt: b.headCommittedAt,
      isDefault: b.isDefault,
      isProtected: b.isProtected,
      aheadBy: b.aheadBy,
      behindBy: b.behindBy,
      comparisonStatus: b.comparisonStatus,
      openChangeRequestNumber: b.openChangeRequestNumber,
      excluded: b.excluded,
      excludedReason: b.excludedReason,
    })),
    pipelineRuns: repo.latestRun
      ? [
          {
            externalId: repo.latestRun.externalId,
            name: repo.latestRun.name,
            status: repo.latestRun.status,
            conclusion: repo.latestRun.conclusion,
            branch: repo.latestRun.branch,
            url: repo.latestRun.url,
            runStartedAt: repo.latestRun.runStartedAt,
            durationSeconds: repo.latestRun.durationSeconds,
          },
        ]
      : [],
    changeRequests: repo.openChangeRequests.map((cr) => ({
      number: cr.number,
      title: cr.title,
      url: cr.url,
      author: cr.author,
      isDraft: cr.isDraft,
      state: cr.state,
      baseRef: cr.baseRef,
      headRef: cr.headRef,
      reviewDecision: cr.reviewDecision,
      mergeableState: cr.mergeableState,
      checksStatus: cr.checksStatus,
      updatedAt: cr.updatedAt,
      isStale: false,
    })),
    security: repo.securityUnavailable
      ? { state: 'not_configured' }
      : {
          state: 'available',
          findings: (repo.securityFindings ?? []).map((f) => ({
            category: f.category,
            severity: f.severity,
            state: f.state,
            summary: f.summary,
            url: f.url,
          })),
        },
    budgets: { state: 'unsupported_by_plan' },
  };
}

export function demoWorkspaces(): WorkspaceDto[] {
  const items = demoRepositories();
  return WORKSPACES.map((w) => {
    const repos = items.filter((r) => r.workspaceSlug === w.slug);
    const counts: Record<string, number> = {};
    for (const r of repos) counts[r.attentionLevel] = (counts[r.attentionLevel] ?? 0) + 1;
    return {
      id: w.id,
      provider: 'github',
      slug: w.slug,
      displayName: w.displayName,
      kind: w.kind,
      repositoryCount: repos.length,
      attentionCounts: counts,
      lastReconciledAt: daysAgo(0.02),
    };
  });
}

export function demoAttention(): AttentionItemDto[] {
  const items: AttentionItemDto[] = [];
  for (const repo of DEMO_REPOS) {
    const health = evaluateRepositoryHealth(healthInput(repo));
    for (const finding of health.findings) {
      if (finding.severity === 'info') continue;
      items.push({
        severity: finding.severity,
        code: finding.code,
        message: finding.message,
        repositoryId: repo.id,
        repositoryFullName: `${repo.workspaceSlug}/${repo.name}`,
        provider: 'github',
        url: `https://github.com/${repo.workspaceSlug}/${repo.name}`,
        observedAt: daysAgo(0.01),
      });
    }
  }
  const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  return items.sort((a, b) => order[a.severity] - order[b.severity]);
}

export function demoOverview(): OverviewDto {
  const items = demoRepositories();
  const active = items.filter((r) => r.status === 'active');
  const counts: Record<string, number> = {};
  for (const r of active) counts[r.attentionLevel] = (counts[r.attentionLevel] ?? 0) + 1;
  const securityCount = DEMO_REPOS.flatMap((r) => r.securityFindings ?? []).filter(
    (f) => f.state === 'open',
  ).length;
  return {
    workspaces: WORKSPACES.length,
    repositories: active.length,
    failingPipelines: active.filter(
      (r) => r.latestRunConclusion === 'failure' || r.latestRunConclusion === 'timed_out',
    ).length,
    openChangeRequests: active.reduce((sum, r) => sum + r.openChangeRequests, 0),
    branchesAhead: active.reduce((sum, r) => sum + r.branchesAhead, 0),
    securityFindings: { state: 'available', count: securityCount },
    budgetWarnings: { state: 'unsupported_by_plan' },
    newRepositories7d: DEMO_REPOS.filter(
      (r) => r.firstSeenDaysAgo !== undefined && r.firstSeenDaysAgo <= 7,
    ).length,
    inaccessibleRepositories: items.filter((r) => r.status === 'inaccessible').length,
    attentionCounts: counts,
    generatedAt: new Date().toISOString(),
  };
}

export function demoPlatformHealth(version: string): PlatformHealthDto {
  return {
    demoMode: true,
    connections: [
      {
        provider: 'mock',
        displayName: 'Demo estate (synthetic data)',
        status: 'active',
        lastSuccessAt: daysAgo(0.001),
      },
    ],
    sync: { pendingJobs: 0, runningJobs: 0, failedJobs: 0 },
    webhooks: { received24h: 0, failed24h: 0 },
    version,
    migrationOk: true,
    generatedAt: new Date().toISOString(),
  };
}
