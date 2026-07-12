/**
 * Provider- and backend-neutral storage ports.
 *
 * These interfaces are the seam between the domain/collectors and a concrete
 * store. The reference backend (`@repo-wrangler/persistence-d1`) fulfils them
 * against Cloudflare D1; a future `persistence-postgres` (roadmap, ADR-011 /
 * SPIKE-014) can fulfil the same contract for a self-hosted Node backend. This
 * package imports only `@repo-wrangler/domain` — no Cloudflare or provider types
 * — so nothing above it is pinned to a runtime.
 *
 * Everything is expressed in domain snapshot terms; row shapes and SQL stay
 * inside each backend implementation.
 */
import type {
  BranchSnapshot,
  BudgetSnapshot,
  ChangeRequestSnapshot,
  PipelineRunSnapshot,
  RepositorySnapshot,
  SecurityFindingSnapshot,
  WorkspaceSnapshot,
} from '@repo-wrangler/domain';

/** A store that upserts and tombstones workspaces for one connection. */
export interface WorkspaceStore {
  upsert(connectionId: string, snapshot: WorkspaceSnapshot): Promise<string>;
  markUnseenInactive(connectionId: string, seenExternalIds: string[]): Promise<void>;
}

/**
 * A store for repository inventory. Discovery upserts what it sees, tombstones
 * what disappeared, and never hard-deletes (ADR-006 reconciliation).
 */
export interface RepositoryStore {
  upsert(workspaceId: string, snapshot: RepositorySnapshot): Promise<string>;
  markRemoved(workspaceId: string, externalId: string): Promise<void>;
  /** After a complete pass, flag known-but-unseen active repos inaccessible. */
  markUnseenInaccessible(workspaceId: string, seenExternalIds: string[]): Promise<void>;
  /** Persist the governance capability snapshot as an opaque JSON string. */
  setGovernance(repositoryId: string, governanceJson: string): Promise<void>;
}

export interface BranchStore {
  replaceForRepository(repositoryId: string, snapshots: BranchSnapshot[]): Promise<void>;
}

export interface ChangeRequestStore {
  upsert(repositoryId: string, snapshot: ChangeRequestSnapshot): Promise<void>;
  markUnseenClosed(repositoryId: string, seenNumbers: number[]): Promise<void>;
}

export interface PipelineRunStore {
  record(repositoryId: string, snapshot: PipelineRunSnapshot): Promise<void>;
}

export interface SecurityFindingStore {
  upsert(repositoryId: string, snapshot: SecurityFindingSnapshot): Promise<void>;
}

export interface BudgetStore {
  replaceForWorkspace(workspaceId: string, snapshots: BudgetSnapshot[]): Promise<void>;
}

/**
 * A durable checkpoint so an interrupted sync resumes without re-scanning the
 * whole estate (ADR-006). Cursors are opaque, backend-defined strings.
 */
export interface SyncCheckpoint {
  job: string;
  cursor?: string;
  updatedAt: string;
}

export interface SyncCheckpointStore {
  get(job: string): Promise<SyncCheckpoint | null>;
  set(job: string, cursor: string | undefined): Promise<void>;
}

/** The full port surface a backend must provide to serve RepoWrangler. */
export interface StoragePort {
  readonly workspaces: WorkspaceStore;
  readonly repositories: RepositoryStore;
  readonly branches: BranchStore;
  readonly changeRequests: ChangeRequestStore;
  readonly pipelineRuns: PipelineRunStore;
  readonly security: SecurityFindingStore;
  readonly budgets: BudgetStore;
  readonly checkpoints: SyncCheckpointStore;
}
