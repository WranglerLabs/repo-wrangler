/**
 * B3b — discovery must chain `enrich_repository` jobs. Per-repo detail
 * (branches, pipeline runs, change requests) is written only by
 * `enrich_repository`, and previously nothing a fresh real-mode instance
 * actually fires (admin sync, wizard connect, the scheduler's first tick)
 * ever enqueued one — only the periodic scheduler tick (a globally-bounded
 * sample) or an inbound webhook did.
 *
 * Calls `runDiscovery`/`runGitLabDiscovery` directly rather than through
 * `runScheduled`: discovery and enrichment share one `sync_jobs` queue, and
 * a full scheduler tick would claim (and run) the newly-enqueued
 * `enrich_repository` job in the same invocation — hitting real, unmocked
 * provider network calls. Testing the discovery pass in isolation keeps
 * these deterministic and offline.
 */
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMigrations, openSqliteD1 } from '@repo-wrangler/persistence-sqlite';
import { makeRepositorySnapshot } from '@repo-wrangler/test-support';
import type { Env } from '../src/bindings';
import { runDiscovery, runGitLabDiscovery } from '../src/scheduled/index';

const migrationsDir = join(__dirname, '../../../migrations');

const githubMocks = vi.hoisted(() => ({
  listInstallations: vi.fn(),
  getInstallationToken: vi.fn(),
  listInstallationRepositories: vi.fn(),
}));

vi.mock('@repo-wrangler/provider-github', async () => {
  const actual = await vi.importActual<typeof import('@repo-wrangler/provider-github')>(
    '@repo-wrangler/provider-github',
  );
  return {
    ...actual,
    listInstallations: githubMocks.listInstallations,
    getInstallationToken: githubMocks.getInstallationToken,
    listInstallationRepositories: githubMocks.listInstallationRepositories,
  };
});

const gitlabMocks = vi.hoisted(() => ({
  getGroupWorkspace: vi.fn(),
  listGroupProjects: vi.fn(),
}));

vi.mock('@repo-wrangler/provider-gitlab', async () => {
  const actual = await vi.importActual<typeof import('@repo-wrangler/provider-gitlab')>(
    '@repo-wrangler/provider-gitlab',
  );
  return {
    ...actual,
    GitLabClient: vi.fn().mockImplementation(() => ({})),
    getGroupWorkspace: gitlabMocks.getGroupWorkspace,
    listGroupProjects: gitlabMocks.listGroupProjects,
  };
});

function githubEnv(db: D1Database): Env {
  return {
    DB: db,
    ASSETS: {},
    DEMO_MODE: 'false',
    GITHUB_APP_ID: 'app-1',
    GITHUB_APP_PRIVATE_KEY: 'pem-1',
  } as unknown as Env;
}

function gitlabEnv(db: D1Database): Env {
  return {
    DB: db,
    ASSETS: {},
    DEMO_MODE: 'false',
    GITLAB_TOKEN: 'tok',
    GITLAB_GROUPS: 'acme-labs',
    GITLAB_BASE_URL: 'https://gitlab.test',
  } as unknown as Env;
}

/** Pending `enrich_repository` jobs — the queue state `claimNextSyncJob` would drain. */
async function pendingEnrichScopes(db: D1Database): Promise<string[]> {
  const result = await db
    .prepare(`SELECT scope FROM sync_jobs WHERE job_type = 'enrich_repository' AND state = 'pending'`)
    .all<{ scope: string }>();
  return result.results.map((r) => r.scope).sort();
}

describe('GitHub discovery chains enrich_repository (B3b)', () => {
  let db: D1Database;

  beforeEach(() => {
    const { d1, raw } = openSqliteD1(':memory:');
    applyMigrations(raw, migrationsDir);
    db = d1 as unknown as D1Database;
    githubMocks.listInstallations.mockReset();
    githubMocks.getInstallationToken.mockReset();
    githubMocks.listInstallationRepositories.mockReset();
    githubMocks.listInstallations.mockResolvedValue([
      { id: 111, account: { id: 5001, login: 'acme-labs', type: 'Organization' } },
    ]);
    githubMocks.getInstallationToken.mockResolvedValue('inst-token');
  });

  it('enqueues enrich_repository for every discovered active+monitored repo', async () => {
    githubMocks.listInstallationRepositories.mockResolvedValue({
      repositories: [
        makeRepositorySnapshot({ externalId: 'r1', fullName: 'acme-labs/widget' }),
        makeRepositorySnapshot({ externalId: 'r2', fullName: 'acme-labs/gadget' }),
      ],
      nextPage: undefined,
    });

    await runDiscovery(githubEnv(db), 'job-1', null, 40);

    expect(await pendingEnrichScopes(db)).toEqual(['acme-labs/gadget', 'acme-labs/widget']);
  });

  it('does not double-enqueue when discovery runs twice back to back', async () => {
    githubMocks.listInstallationRepositories.mockResolvedValue({
      repositories: [makeRepositorySnapshot({ externalId: 'r1', fullName: 'acme-labs/widget' })],
      nextPage: undefined,
    });

    await runDiscovery(githubEnv(db), 'job-1', null, 40);
    expect(await pendingEnrichScopes(db)).toEqual(['acme-labs/widget']);

    // A second discovery pass (e.g. a second admin-triggered sync, or the
    // wizard's auto-sync firing again before the first enrich job has run)
    // must not pile up a duplicate pending job for the same repo —
    // enqueueSyncJob's own pending-job dedupe is what's relied on here.
    await runDiscovery(githubEnv(db), 'job-2', null, 40);
    expect(await pendingEnrichScopes(db)).toEqual(['acme-labs/widget']);

    const count = await db
      .prepare(`SELECT COUNT(*) AS n FROM sync_jobs WHERE job_type = 'enrich_repository' AND scope = 'acme-labs/widget'`)
      .first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it('does not enqueue enrichment for a repo in an ignored workspace', async () => {
    githubMocks.listInstallationRepositories.mockResolvedValue({
      repositories: [makeRepositorySnapshot({ externalId: 'r1', fullName: 'acme-labs/widget' })],
      nextPage: undefined,
    });

    // First pass creates + ignores the workspace.
    await runDiscovery(githubEnv(db), 'job-1', null, 40);
    await db.prepare(`UPDATE workspaces SET monitoring_state = 'ignored'`).run();
    await db.prepare(`DELETE FROM sync_jobs`).run();

    githubMocks.listInstallationRepositories.mockClear();
    await runDiscovery(githubEnv(db), 'job-2', null, 40);

    expect(githubMocks.listInstallationRepositories).not.toHaveBeenCalled();
    expect(await pendingEnrichScopes(db)).toEqual([]);
  });
});

describe('GitLab discovery chains enrich_repository (B3b)', () => {
  let db: D1Database;

  beforeEach(() => {
    const { d1, raw } = openSqliteD1(':memory:');
    applyMigrations(raw, migrationsDir);
    db = d1 as unknown as D1Database;
    gitlabMocks.getGroupWorkspace.mockReset();
    gitlabMocks.listGroupProjects.mockReset();
    gitlabMocks.getGroupWorkspace.mockResolvedValue({
      externalId: 'grp-1',
      slug: 'acme-labs',
      kind: 'group',
    });
  });

  it('enqueues enrich_repository for every discovered active+monitored project', async () => {
    gitlabMocks.listGroupProjects.mockResolvedValue({
      repositories: [makeRepositorySnapshot({ externalId: 'p1', fullName: 'acme-labs/service' })],
      nextPage: undefined,
    });

    await runGitLabDiscovery(gitlabEnv(db), 'job-1');

    expect(await pendingEnrichScopes(db)).toEqual(['acme-labs/service']);
  });
});
