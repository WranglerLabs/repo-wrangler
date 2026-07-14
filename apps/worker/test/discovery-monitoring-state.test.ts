/**
 * Onboarding design Phase A2 — discovery's workspace-level skip. An ignored
 * workspace is still upserted (so it stays current and visible) but its
 * repositories are never paginated. Exercised against a real (in-memory)
 * SQLite-backed D1 handle with the GitLab provider client mocked out, since
 * this is what actually spends the API budget.
 */
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMigrations, openSqliteD1 } from '@repo-wrangler/persistence-sqlite';
import {
  ensureGitLabConnection,
  getWorkspaceMonitoringState,
  upsertWorkspace,
} from '@repo-wrangler/persistence-d1';
import type { Env } from '../src/bindings';
import { runScheduled } from '../src/scheduled/index';

const migrationsDir = join(__dirname, '../../../migrations');

const mocks = vi.hoisted(() => ({
  getGroupWorkspace: vi.fn(),
  listGroupProjects: vi.fn(),
}));

vi.mock('@repo-wrangler/provider-gitlab', () => ({
  GitLabClient: vi.fn().mockImplementation(() => ({})),
  getGroupWorkspace: mocks.getGroupWorkspace,
  listGroupProjects: mocks.listGroupProjects,
  listOpenMergeRequests: vi.fn(),
  collectGitLabBranches: vi.fn(),
  latestDefaultBranchPipeline: vi.fn(),
}));

function gitlabEnv(db: D1Database): Env {
  // No GITHUB_APP_ID, so runDiscovery (GitHub) no-ops instantly and only the
  // GitLab loop under test spends any budget.
  return {
    DB: db,
    ASSETS: {},
    GITLAB_TOKEN: 'tok',
    GITLAB_GROUPS: 'acme-labs',
    GITLAB_BASE_URL: 'https://gitlab.test',
  } as unknown as Env;
}

describe('runScheduled → GitLab discovery — A2 workspace-level skip', () => {
  let db: D1Database;
  let connectionId: string;

  beforeEach(async () => {
    const { d1, raw } = openSqliteD1(':memory:');
    applyMigrations(raw, migrationsDir);
    db = d1 as unknown as D1Database;
    connectionId = await ensureGitLabConnection(db, 'https://gitlab.test');
    mocks.getGroupWorkspace.mockReset();
    mocks.listGroupProjects.mockReset();
    mocks.getGroupWorkspace.mockResolvedValue({
      externalId: 'grp-1',
      slug: 'acme-labs',
      kind: 'group',
    });
  });

  it('upserts an ignored workspace but never paginates its projects', async () => {
    const workspaceId = await upsertWorkspace(db, connectionId, {
      externalId: 'grp-1',
      slug: 'acme-labs',
      kind: 'group',
    });
    await db
      .prepare(`UPDATE workspaces SET monitoring_state = 'ignored' WHERE id = ?1`)
      .bind(workspaceId)
      .run();

    await runScheduled(gitlabEnv(db), '*/5 * * * *');

    expect(mocks.getGroupWorkspace).toHaveBeenCalled();
    expect(mocks.listGroupProjects).not.toHaveBeenCalled();
    // The upsert still ran — the workspace stays current and visible.
    expect(await getWorkspaceMonitoringState(db, workspaceId)).toBe('ignored');
  });

  it('paginates projects for a monitored (default) workspace as before', async () => {
    mocks.listGroupProjects.mockResolvedValue({ repositories: [], nextPage: undefined });

    await runScheduled(gitlabEnv(db), '*/5 * * * *');

    expect(mocks.listGroupProjects).toHaveBeenCalled();
  });
});
