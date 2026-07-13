import type {
  ActivityEventDto,
  AttentionItemDto,
  EstateBranchDto,
  EstateBudgetsDto,
  EstateChangeRequestDto,
  EstatePipelineDto,
  EstateSecurityFindingDto,
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
 * Synthetic demo estate — deliberately, unmistakably fictional and a bit of fun.
 * The GitHub side is themed after *Back to the Future* (orgs Hill Valley Labs and
 * Twin Pines, user doc-brown; repos flux-capacitor, delorean-dashboard,
 * hoverboard-firmware, mr-fusion-cli …), and the GitLab side after *Pinky and the
 * Brain* (group Acme Labs; repos world-domination-api and brain-schemes). None of
 * it is real — no real organization, repository, or person appears here.
 *
 * Everything else is production-faithful: all attention levels are computed by the
 * real domain health engine, so demo mode exercises the exact same rules as a live
 * estate. Change the names, keep the behaviour.
 */

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

interface DemoRepo {
  id: string;
  provider?: 'github' | 'gitlab';
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

// Built lazily inside a request context: Workers return Date.now() === 0
// during module evaluation, which would bake 1970 timestamps into the estate.
function buildDemoRepos(): DemoRepo[] {
  return [
  {
    id: 'demo-r1',
    workspaceSlug: 'hill-valley-labs',
    name: 'flux-capacitor',
    description: 'Time-circuit flux capacitor control service — 1.21 GW.',
    visibility: 'private',
    defaultBranch: 'main',
    pushedDaysAgo: 0,
    language: 'TypeScript',
    topics: ['api', 'production'],
    license: 'Apache-2.0',
    branches: [
      branch({ name: 'main', isDefault: true, isProtected: true, comparisonStatus: 'identical' }),
      branch({
        name: 'feature/flux-calibration',
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
      url: 'https://github.com/hill-valley-labs/flux-capacitor/actions',
    }),
    openChangeRequests: [
      {
        number: 218,
        title: 'Add per-timeline flux calibration',
        author: 'marty-mcfly',
        isDraft: false,
        state: 'open',
        baseRef: 'main',
        headRef: 'feature/flux-calibration',
        requestedReviewers: ['doc-brown'],
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
    workspaceSlug: 'hill-valley-labs',
    name: 'delorean-dashboard',
    description: 'Customer-facing DeLorean control dashboard.',
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
        url: 'https://github.com/hill-valley-labs/delorean-dashboard/security',
        createdAt: daysAgo(0.3),
      },
    ],
  },
  {
    id: 'demo-r3',
    workspaceSlug: 'hill-valley-labs',
    name: 'hill-valley-grid',
    description: 'Terraform modules for the Hill Valley power grid.',
    visibility: 'private',
    defaultBranch: 'main',
    pushedDaysAgo: 6,
    language: 'HCL',
    topics: ['infrastructure'],
    branches: [
      branch({ name: 'main', isDefault: true, isProtected: true, comparisonStatus: 'identical' }),
      branch({
        name: 'spike/time-circuit-redesign',
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
    workspaceSlug: 'hill-valley-labs',
    name: 'timeline-1955',
    description: 'Legacy 1955-timeline ledger bridge, migration pending.',
    visibility: 'private',
    defaultBranch: 'master',
    pushedDaysAgo: 240,
    language: 'C#',
    branches: [
      branch({ name: 'master', isDefault: true, comparisonStatus: 'identical' }),
      branch({
        name: 'hotfix/1955-rounding',
        comparisonStatus: 'diverged',
        aheadBy: 3,
        behindBy: 88,
        headCommittedAt: daysAgo(410),
      }),
    ],
    openChangeRequests: [
      {
        number: 77,
        title: 'Bridge the 1955 ledger to the new timeline',
        author: 'biff-tannen',
        isDraft: false,
        state: 'open',
        baseRef: 'master',
        headRef: 'feature/ledger-bridge',
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
    workspaceSlug: 'twin-pines',
    name: 'hoverboard-firmware',
    description: 'Mattel hoverboard control firmware experiments.',
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
    workspaceSlug: 'twin-pines',
    name: 'mr-fusion-cli',
    description: 'Mr. Fusion home energy reactor CLI.',
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
    workspaceSlug: 'twin-pines',
    name: 'twin-pines-docs',
    description: 'Documentation for Twin Pines tooling.',
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
    workspaceSlug: 'doc-brown',
    name: 'einstein-tracker',
    description: 'Personal experiment log (property of E. Brown).',
    visibility: 'private',
    defaultBranch: 'main',
    pushedDaysAgo: 9,
    language: 'Python',
    branches: [
      branch({ name: 'main', isDefault: true, comparisonStatus: 'identical' }),
      branch({
        name: 'feature/self-lacing',
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
        title: 'Add self-lacing calibration',
        author: 'doc-brown',
        isDraft: true,
        state: 'open',
        baseRef: 'main',
        headRef: 'feature/self-lacing',
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
    id: 'demo-r10',
    provider: 'gitlab',
    workspaceSlug: 'acme-labs',
    name: 'world-domination-api',
    description: 'Nightly plan to take over the world (GitLab).',
    visibility: 'private',
    defaultBranch: 'main',
    pushedDaysAgo: 1,
    language: 'Python',
    branches: [
      branch({ name: 'main', isDefault: true, isProtected: true, comparisonStatus: 'identical' }),
      branch({
        name: 'feature/takeover-webhooks',
        comparisonStatus: 'ahead',
        aheadBy: 3,
        behindBy: 0,
        openChangeRequestNumber: 31,
        headCommittedAt: daysAgo(1),
      }),
    ],
    latestRun: run({ externalId: 'run-10', name: 'pipeline', branch: 'main', runStartedAt: daysAgo(1) }),
    openChangeRequests: [
      {
        number: 31,
        title: 'Add outbound world-takeover webhooks',
        author: 'the-brain',
        isDraft: false,
        state: 'open',
        baseRef: 'main',
        headRef: 'feature/takeover-webhooks',
        requestedReviewers: [],
        mergeableState: 'clean',
        checksStatus: 'passing',
        createdAt: daysAgo(2),
        updatedAt: daysAgo(1),
      },
    ],
    securityUnavailable: true,
  },
  {
    id: 'demo-r11',
    provider: 'gitlab',
    workspaceSlug: 'acme-labs',
    name: 'brain-schemes',
    description: 'World-domination schemes and runbooks (GitLab).',
    visibility: 'private',
    defaultBranch: 'main',
    pushedDaysAgo: 20,
    language: 'Markdown',
    branches: [branch({ name: 'main', isDefault: true, comparisonStatus: 'identical' })],
    latestRun: run({
      externalId: 'run-11',
      name: 'pipeline',
      conclusion: 'failure',
      branch: 'main',
      runStartedAt: daysAgo(20),
    }),
    openChangeRequests: [],
    securityUnavailable: true,
  },
  {
    id: 'demo-r9',
    workspaceSlug: 'doc-brown',
    name: 'outatime-blog',
    description: 'Retired OUTATIME blog source.',
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
}

let demoRepoCache: DemoRepo[] | undefined;
function getDemoRepos(): DemoRepo[] {
  demoRepoCache ??= buildDemoRepos();
  return demoRepoCache;
}

const WORKSPACES: Array<{
  id: string;
  slug: string;
  displayName: string;
  kind: 'organization' | 'user' | 'group';
  provider: 'github' | 'gitlab';
}> = [
  { id: 'demo-w1', slug: 'hill-valley-labs', displayName: 'Hill Valley Labs', kind: 'organization', provider: 'github' },
  { id: 'demo-w2', slug: 'twin-pines', displayName: 'Twin Pines', kind: 'organization', provider: 'github' },
  { id: 'demo-w3', slug: 'doc-brown', displayName: 'doc-brown', kind: 'user', provider: 'github' },
  { id: 'demo-w4', slug: 'acme-labs', displayName: 'Acme Labs Group', kind: 'group', provider: 'gitlab' },
];

function repoUrl(repo: DemoRepo): string {
  const host = repo.provider === 'gitlab' ? 'gitlab.com' : 'github.com';
  return `https://${host}/${repo.workspaceSlug}/${repo.name}`;
}

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
      url: repoUrl(repo),
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
    provider: repo.provider ?? 'github',
    workspaceSlug: repo.workspaceSlug,
    name: repo.name,
    fullName: `${repo.workspaceSlug}/${repo.name}`,
    url: repoUrl(repo),
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
  return getDemoRepos().map(toListItem);
}

export function demoRepositoryDetail(id: string): RepositoryDetailDto | undefined {
  const repo = getDemoRepos().find((r) => r.id === id);
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
    governance: {
      state: 'available',
      defaultBranchProtected: repo.branches.some((b) => b.isDefault && b.isProtected),
      files: {
        readme: true,
        license: Boolean(repo.license),
        contributing: repo.workspaceSlug === 'hill-valley-labs',
        codeOfConduct: repo.workspaceSlug === 'hill-valley-labs',
      },
      healthPercentage: repo.license ? 85 : 55,
    },
    budgets:
      repo.workspaceSlug === 'hill-valley-labs'
        ? {
            state: 'available',
            items: [
              {
                product: 'actions',
                scopeType: 'organization',
                scopeTarget: 'hill-valley-labs',
                amount: 50,
                unit: 'USD',
                preventFurtherUsage: true,
                alertStatus: '92% consumed',
              },
            ],
          }
        : { state: 'unsupported_by_plan' },
  };
}

export function demoEstateBranches(): EstateBranchDto[] {
  const items: EstateBranchDto[] = [];
  for (const repo of getDemoRepos()) {
    if (repo.status === 'inaccessible') continue;
    for (const b of repo.branches) {
      if (b.isDefault || b.excluded) continue;
      if (b.comparisonStatus !== 'ahead' && b.comparisonStatus !== 'diverged') continue;
      items.push({
        repositoryId: repo.id,
        repositoryFullName: `${repo.workspaceSlug}/${repo.name}`,
        provider: repo.provider ?? 'github',
        name: b.name,
        headCommittedAt: b.headCommittedAt,
        aheadBy: b.aheadBy,
        behindBy: b.behindBy,
        comparisonStatus: b.comparisonStatus,
        openChangeRequestNumber: b.openChangeRequestNumber,
        isProtected: b.isProtected,
      });
    }
  }
  return items.sort((a, b) => (b.aheadBy ?? 0) - (a.aheadBy ?? 0));
}

export function demoEstateChangeRequests(): EstateChangeRequestDto[] {
  const items: EstateChangeRequestDto[] = [];
  for (const repo of getDemoRepos()) {
    if (repo.status === 'inaccessible') continue;
    for (const cr of repo.openChangeRequests) {
      if (cr.state !== 'open') continue;
      let attention: EstateChangeRequestDto['attention'] = 'normal';
      if (cr.isDraft) attention = 'draft';
      else if (cr.mergeableState === 'dirty' || cr.mergeableState === 'blocked') {
        attention = 'blocked';
      } else if (
        cr.updatedAt &&
        Date.now() - Date.parse(cr.updatedAt) > 14 * 24 * 60 * 60 * 1000
      ) {
        attention = 'stale';
      } else if (cr.mergeableState === 'clean') attention = 'ready';
      items.push({
        repositoryId: repo.id,
        repositoryFullName: `${repo.workspaceSlug}/${repo.name}`,
        provider: repo.provider ?? 'github',
        number: cr.number,
        title: cr.title,
        url: cr.url,
        author: cr.author,
        isDraft: cr.isDraft,
        baseRef: cr.baseRef,
        headRef: cr.headRef,
        mergeableState: cr.mergeableState,
        checksStatus: cr.checksStatus,
        updatedAt: cr.updatedAt,
        attention,
      });
    }
  }
  const order = { blocked: 0, stale: 1, ready: 2, normal: 3, draft: 4 };
  return items.sort((a, b) => order[a.attention] - order[b.attention]);
}

export function demoWorkspaces(): WorkspaceDto[] {
  const items = demoRepositories();
  return WORKSPACES.map((w) => {
    const repos = items.filter((r) => r.workspaceSlug === w.slug);
    const counts: Record<string, number> = {};
    for (const r of repos) counts[r.attentionLevel] = (counts[r.attentionLevel] ?? 0) + 1;
    return {
      id: w.id,
      provider: w.provider,
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
  for (const repo of getDemoRepos()) {
    const health = evaluateRepositoryHealth(healthInput(repo));
    for (const finding of health.findings) {
      if (finding.severity === 'info') continue;
      items.push({
        severity: finding.severity,
        code: finding.code,
        message: finding.message,
        repositoryId: repo.id,
        repositoryFullName: `${repo.workspaceSlug}/${repo.name}`,
        provider: repo.provider ?? 'github',
        url: repoUrl(repo),
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
  const securityCount = getDemoRepos().flatMap((r) => r.securityFindings ?? []).filter(
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
    newRepositories7d: getDemoRepos().filter(
      (r) => r.firstSeenDaysAgo !== undefined && r.firstSeenDaysAgo <= 7,
    ).length,
    inaccessibleRepositories: items.filter((r) => r.status === 'inaccessible').length,
    attentionCounts: counts,
    generatedAt: new Date().toISOString(),
  };
}

export function demoEstatePipelines(): EstatePipelineDto[] {
  const items: EstatePipelineDto[] = [];
  for (const repo of getDemoRepos()) {
    if (repo.status === 'inaccessible' || !repo.latestRun) continue;
    items.push({
      repositoryId: repo.id,
      repositoryFullName: `${repo.workspaceSlug}/${repo.name}`,
      provider: repo.provider ?? 'github',
      name: repo.latestRun.name,
      status: repo.latestRun.status,
      conclusion: repo.latestRun.conclusion,
      branch: repo.latestRun.branch,
      url: repo.latestRun.url,
      runStartedAt: repo.latestRun.runStartedAt,
      durationSeconds: repo.latestRun.durationSeconds,
    });
  }
  const order = (c?: string) => (c === 'failure' || c === 'timed_out' ? 0 : c === 'cancelled' ? 1 : 2);
  return items.sort((a, b) => order(a.conclusion) - order(b.conclusion));
}

export function demoEstateSecurity(): EstateSecurityFindingDto[] {
  const items: EstateSecurityFindingDto[] = [];
  for (const repo of getDemoRepos()) {
    if (repo.status === 'inaccessible') continue;
    for (const finding of repo.securityFindings ?? []) {
      if (finding.state !== 'open') continue;
      items.push({
        repositoryId: repo.id,
        repositoryFullName: `${repo.workspaceSlug}/${repo.name}`,
        provider: repo.provider ?? 'github',
        category: finding.category,
        severity: finding.severity,
        state: finding.state,
        summary: finding.summary,
        url: finding.url,
        createdAt: finding.createdAt,
      });
    }
  }
  return items.sort((a) => (a.category === 'secret_scanning' ? -1 : 1));
}

export function demoEstateBudgets(): EstateBudgetsDto {
  return {
    state: 'available',
    items: [
      {
        workspaceSlug: 'hill-valley-labs',
        provider: 'github',
        product: 'actions',
        scopeType: 'organization',
        scopeTarget: 'hill-valley-labs',
        amount: 50,
        unit: 'USD',
        preventFurtherUsage: true,
        alertStatus: '92% consumed',
      },
      {
        workspaceSlug: 'hill-valley-labs',
        provider: 'github',
        product: 'git_lfs',
        scopeType: 'organization',
        scopeTarget: 'hill-valley-labs',
        amount: 10,
        unit: 'USD',
        preventFurtherUsage: false,
        alertStatus: '18% consumed',
      },
    ],
  };
}

export function demoActivity(): ActivityEventDto[] {
  return [
    { at: daysAgo(0.01), kind: 'sync', message: 'Enrichment completed for hill-valley-labs/flux-capacitor.' },
    { at: daysAgo(0.02), kind: 'health', message: 'hill-valley-labs/delorean-dashboard escalated to critical (secret scanning alert).' },
    { at: daysAgo(0.05), kind: 'sync', message: 'Discovery reconciliation completed — 10 repositories seen, 1 inaccessible.' },
    { at: daysAgo(0.4), kind: 'discovery', message: 'New repository discovered: twin-pines/mr-fusion-cli.' },
    { at: daysAgo(0.6), kind: 'webhook', message: 'workflow_run webhook applied for hill-valley-labs/flux-capacitor (failure).' },
    { at: daysAgo(1.1), kind: 'admin', actor: 'demo', message: 'Manual discovery requested from Administration.' },
    { at: daysAgo(2), kind: 'billing', message: 'Budget sync completed for hill-valley-labs (2 budgets).' },
  ];
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
