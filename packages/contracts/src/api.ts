import { z } from 'zod';

/**
 * Shared API contracts between the Worker API and the React client.
 * The Worker validates outbound shapes in tests; the client infers types.
 */

export const attentionLevelSchema = z.enum([
  'critical',
  'high',
  'medium',
  'low',
  'healthy',
  'unknown',
]);
export type AttentionLevelDto = z.infer<typeof attentionLevelSchema>;

export const capabilityStateSchema = z.enum([
  'available',
  'not_configured',
  'not_authorized',
  'unsupported_by_provider',
  'unsupported_by_plan',
  'temporarily_unavailable',
  'rate_limited',
  'error',
]);
export type CapabilityStateDto = z.infer<typeof capabilityStateSchema>;

export const overviewSchema = z.object({
  workspaces: z.number(),
  repositories: z.number(),
  failingPipelines: z.number(),
  openChangeRequests: z.number(),
  branchesAhead: z.number(),
  securityFindings: z.object({
    state: capabilityStateSchema,
    count: z.number().optional(),
  }),
  budgetWarnings: z.object({
    state: capabilityStateSchema,
    count: z.number().optional(),
  }),
  newRepositories7d: z.number(),
  inaccessibleRepositories: z.number(),
  attentionCounts: z.record(z.string(), z.number()),
  generatedAt: z.string(),
});
export type OverviewDto = z.infer<typeof overviewSchema>;

export const attentionItemSchema = z.object({
  severity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
  code: z.string(),
  message: z.string(),
  repositoryId: z.string().optional(),
  repositoryFullName: z.string().optional(),
  provider: z.string().optional(),
  url: z.string().optional(),
  observedAt: z.string().optional(),
});
export type AttentionItemDto = z.infer<typeof attentionItemSchema>;

export const repositoryListItemSchema = z.object({
  id: z.string(),
  provider: z.string(),
  workspaceSlug: z.string(),
  name: z.string(),
  fullName: z.string(),
  url: z.string().optional(),
  visibility: z.string().optional(),
  isArchived: z.boolean(),
  defaultBranch: z.string().optional(),
  defaultBranchStatus: z.enum(['current', 'work_pending', 'untracked_work', 'diverged', 'unknown']),
  branchesAhead: z.number(),
  latestRunConclusion: z.string().optional(),
  latestRunAt: z.string().optional(),
  openChangeRequests: z.number(),
  attentionLevel: attentionLevelSchema,
  primaryLanguage: z.string().optional(),
  pushedAt: z.string().optional(),
  lastSyncedAt: z.string().optional(),
  status: z.string(),
  /** Present only when the caller requested `includeIgnored` (B5 estate scope). */
  monitoringState: z.enum(['monitored', 'ignored']).optional(),
  workspaceId: z.string().optional(),
});
export type RepositoryListItemDto = z.infer<typeof repositoryListItemSchema>;

export const branchDtoSchema = z.object({
  name: z.string(),
  headCommittedAt: z.string().optional(),
  isDefault: z.boolean(),
  isProtected: z.boolean(),
  aheadBy: z.number().optional(),
  behindBy: z.number().optional(),
  comparisonStatus: z.string(),
  openChangeRequestNumber: z.number().optional(),
  excluded: z.boolean(),
  excludedReason: z.string().optional(),
});
export type BranchDto = z.infer<typeof branchDtoSchema>;

export const pipelineRunDtoSchema = z.object({
  externalId: z.string(),
  name: z.string().optional(),
  status: z.string(),
  conclusion: z.string().optional(),
  branch: z.string().optional(),
  url: z.string().optional(),
  runStartedAt: z.string().optional(),
  durationSeconds: z.number().optional(),
});
export type PipelineRunDto = z.infer<typeof pipelineRunDtoSchema>;

export const changeRequestDtoSchema = z.object({
  number: z.number(),
  title: z.string().optional(),
  url: z.string().optional(),
  author: z.string().optional(),
  isDraft: z.boolean(),
  state: z.string(),
  baseRef: z.string().optional(),
  headRef: z.string().optional(),
  reviewDecision: z.string().optional(),
  mergeableState: z.string().optional(),
  checksStatus: z.string().optional(),
  updatedAt: z.string().optional(),
  isStale: z.boolean(),
});
export type ChangeRequestDto = z.infer<typeof changeRequestDtoSchema>;

export const repositoryDetailSchema = z.object({
  repository: repositoryListItemSchema.extend({
    description: z.string().optional(),
    topics: z.array(z.string()),
    licenseSpdx: z.string().optional(),
    isFork: z.boolean(),
  }),
  healthFindings: z.array(
    z.object({ code: z.string(), severity: z.string(), message: z.string() }),
  ),
  branches: z.array(branchDtoSchema),
  pipelineRuns: z.array(pipelineRunDtoSchema),
  changeRequests: z.array(changeRequestDtoSchema),
  security: z.object({
    state: capabilityStateSchema,
    findings: z
      .array(
        z.object({
          category: z.string(),
          severity: z.string().optional(),
          state: z.string().optional(),
          summary: z.string().optional(),
          url: z.string().optional(),
        }),
      )
      .optional(),
  }),
  governance: z
    .object({
      state: capabilityStateSchema,
      defaultBranchProtected: z.boolean().optional(),
      files: z.record(z.string(), z.boolean()).optional(),
      healthPercentage: z.number().optional(),
    })
    .optional(),
  budgets: z.object({
    state: capabilityStateSchema,
    items: z
      .array(
        z.object({
          product: z.string().optional(),
          scopeType: z.string().optional(),
          scopeTarget: z.string().optional(),
          amount: z.number().optional(),
          unit: z.string().optional(),
          preventFurtherUsage: z.boolean(),
          alertStatus: z.string().optional(),
        }),
      )
      .optional(),
  }),
});
export type RepositoryDetailDto = z.infer<typeof repositoryDetailSchema>;

export const workspaceDtoSchema = z.object({
  id: z.string(),
  connectionId: z.string().optional(),
  provider: z.string(),
  slug: z.string(),
  displayName: z.string().optional(),
  kind: z.string(),
  avatarUrl: z.string().optional(),
  repositoryCount: z.number(),
  attentionCounts: z.record(z.string(), z.number()),
  lastReconciledAt: z.string().optional(),
  monitoringState: z.enum(['monitored', 'ignored']).optional(),
});
export type WorkspaceDto = z.infer<typeof workspaceDtoSchema>;

export const platformHealthSchema = z.object({
  demoMode: z.boolean(),
  connections: z.array(
    z.object({
      provider: z.string(),
      displayName: z.string(),
      status: z.string(),
      lastSuccessAt: z.string().optional(),
      lastErrorCode: z.string().optional(),
    }),
  ),
  sync: z.object({
    pendingJobs: z.number(),
    runningJobs: z.number(),
    failedJobs: z.number(),
    oldestStaleRepositorySyncedAt: z.string().optional(),
  }),
  webhooks: z.object({
    received24h: z.number(),
    failed24h: z.number(),
  }),
  version: z.string(),
  migrationOk: z.boolean(),
  generatedAt: z.string(),
});
export type PlatformHealthDto = z.infer<typeof platformHealthSchema>;

export const creditsSchema = z.object({
  projects: z.array(
    z.object({
      name: z.string(),
      upstream: z.string(),
      commit: z.string(),
      license: z.string(),
      copyright: z.string(),
      usage: z.array(z.string()),
      copiedFiles: z.array(z.string()),
      modifications: z.string(),
    }),
  ),
});
export type CreditsDto = z.infer<typeof creditsSchema>;

export const estateBranchSchema = z.object({
  repositoryId: z.string(),
  repositoryFullName: z.string(),
  provider: z.string(),
  name: z.string(),
  headCommittedAt: z.string().optional(),
  aheadBy: z.number().optional(),
  behindBy: z.number().optional(),
  comparisonStatus: z.string(),
  openChangeRequestNumber: z.number().optional(),
  isProtected: z.boolean(),
});
export type EstateBranchDto = z.infer<typeof estateBranchSchema>;

export const estateChangeRequestSchema = z.object({
  repositoryId: z.string(),
  repositoryFullName: z.string(),
  provider: z.string(),
  number: z.number(),
  title: z.string().optional(),
  url: z.string().optional(),
  author: z.string().optional(),
  isDraft: z.boolean(),
  baseRef: z.string().optional(),
  headRef: z.string().optional(),
  mergeableState: z.string().optional(),
  checksStatus: z.string().optional(),
  updatedAt: z.string().optional(),
  attention: z.enum(['ready', 'blocked', 'stale', 'draft', 'normal']),
});
export type EstateChangeRequestDto = z.infer<typeof estateChangeRequestSchema>;

export const governanceDtoSchema = z.object({
  state: capabilityStateSchema,
  defaultBranchProtected: z.boolean().optional(),
  files: z
    .object({
      readme: z.boolean().optional(),
      license: z.boolean().optional(),
      contributing: z.boolean().optional(),
      codeOfConduct: z.boolean().optional(),
      issueTemplate: z.boolean().optional(),
      pullRequestTemplate: z.boolean().optional(),
    })
    .optional(),
  healthPercentage: z.number().optional(),
});
export type GovernanceDto = z.infer<typeof governanceDtoSchema>;

export const budgetDtoSchema = z.object({
  product: z.string().optional(),
  scopeType: z.string().optional(),
  scopeTarget: z.string().optional(),
  amount: z.number().optional(),
  unit: z.string().optional(),
  preventFurtherUsage: z.boolean(),
  alertStatus: z.string().optional(),
});
export type BudgetDto = z.infer<typeof budgetDtoSchema>;

export const estatePipelineSchema = z.object({
  repositoryId: z.string(),
  repositoryFullName: z.string(),
  provider: z.string(),
  name: z.string().optional(),
  status: z.string(),
  conclusion: z.string().optional(),
  branch: z.string().optional(),
  url: z.string().optional(),
  runStartedAt: z.string().optional(),
  durationSeconds: z.number().optional(),
});
export type EstatePipelineDto = z.infer<typeof estatePipelineSchema>;

export const estateSecurityFindingSchema = z.object({
  repositoryId: z.string(),
  repositoryFullName: z.string(),
  provider: z.string(),
  category: z.string(),
  severity: z.string().optional(),
  state: z.string().optional(),
  summary: z.string().optional(),
  url: z.string().optional(),
  createdAt: z.string().optional(),
});
export type EstateSecurityFindingDto = z.infer<typeof estateSecurityFindingSchema>;

export const estateBudgetsSchema = z.object({
  state: capabilityStateSchema,
  items: z
    .array(
      z.object({
        workspaceSlug: z.string(),
        provider: z.string(),
        product: z.string().optional(),
        scopeType: z.string().optional(),
        scopeTarget: z.string().optional(),
        amount: z.number().optional(),
        unit: z.string().optional(),
        preventFurtherUsage: z.boolean(),
        alertStatus: z.string().optional(),
      }),
    )
    .optional(),
});
export type EstateBudgetsDto = z.infer<typeof estateBudgetsSchema>;

export const activityEventSchema = z.object({
  at: z.string(),
  kind: z.string(),
  actor: z.string().optional(),
  message: z.string(),
});
export type ActivityEventDto = z.infer<typeof activityEventSchema>;

export const sessionUserSchema = z.object({
  login: z.string(),
  role: z.enum(['owner', 'admin', 'viewer']),
  demo: z.boolean().optional(),
});
export type SessionUserDto = z.infer<typeof sessionUserSchema>;

export const savedViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  definition: z.string(),
  createdAt: z.string(),
});
export type SavedViewDto = z.infer<typeof savedViewSchema>;

// Onboarding design Phase B — first-run detection, connect wizard, and estate
// scope management.

export const onboardingStatusSchema = z.object({
  demo: z.boolean(),
  /** `provider_connections` count. */
  connections: z.number(),
  /** Workspaces with `monitoring_state = 'monitored'`. */
  monitoredWorkspaces: z.number(),
  /** Real mode AND `monitoredWorkspaces === 0` — drives the wizard redirect. */
  firstRun: z.boolean(),
});
export type OnboardingStatusDto = z.infer<typeof onboardingStatusSchema>;

export const connectionWorkspaceSchema = z.object({
  id: z.string(),
  slug: z.string(),
  displayName: z.string().optional(),
  kind: z.string(),
  monitoringState: z.enum(['monitored', 'ignored']),
  repoCount: z.number().optional(),
});
export type ConnectionWorkspaceDto = z.infer<typeof connectionWorkspaceSchema>;

export const gitlabGroupSearchResultSchema = z.object({
  externalId: z.string(),
  fullPath: z.string(),
  name: z.string(),
  projectCount: z.number().optional(),
});
export type GitLabGroupSearchResultDto = z.infer<typeof gitlabGroupSearchResultSchema>;

export const connectResultSchema = z.object({
  connectionId: z.string(),
  appSlug: z.string().optional(),
  installUrl: z.string().optional(),
});
export type ConnectResultDto = z.infer<typeof connectResultSchema>;

/** Presence + masked hint only (B5 Credentials panel) — never the value. */
export const connectionSecretHintSchema = z.object({
  name: z.string(),
  present: z.boolean(),
  hint: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type ConnectionSecretHintDto = z.infer<typeof connectionSecretHintSchema>;

export const connectionDtoSchema = z.object({
  id: z.string(),
  provider: z.string(),
  displayName: z.string(),
  status: z.string(),
  baseUrl: z.string().optional(),
  lastSuccessAt: z.string().optional(),
  lastErrorCode: z.string().optional(),
});
export type ConnectionDto = z.infer<typeof connectionDtoSchema>;
