import { join } from 'node:path';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionUserDto } from '@repo-wrangler/contracts';
import { applyMigrations, openSqliteD1 } from '@repo-wrangler/persistence-sqlite';
import { upgradeRoutes } from '../src/api/upgrades';
import type { Env } from '../src/bindings';
import type { AppContext } from '../src/middleware/auth';

const migrationsDir = join(__dirname, '../../../migrations');
const sourceDigest = `sha256:${'a'.repeat(64)}`;
const targetDigest = `sha256:${'b'.repeat(64)}`;
let controllerCheckpoint: Record<string, unknown> | undefined;
let controllerPreviewYaml: string | undefined;

const manifest = {
  schemaVersion: '1.1', product: 'RepoWrangler', version: 'v1.0.24',
  releasedAt: '2026-09-05T00:00:00.000Z', channel: 'stable',
  releaseNotesUrl: 'https://example.test/releases/v1.0.24',
  manifestAttestationUrl: 'https://example.test/manifest.sigstore.json',
  artifacts: [{
    target: 'azure-container-apps', url: 'https://example.test/aca.tar.gz',
    sha256: 'c'.repeat(64), size: 1024,
    attestationUrl: 'https://example.test/provenance.sigstore.json',
  }],
  containerImages: [{
    target: 'azure-container-apps',
    image: 'ghcr.io/wranglerlabs/repo-wrangler-server', digest: targetDigest,
  }],
  compatibility: {
    minimumSourceVersion: 'v1.0.20',
    databaseSchema: { minimum: 9, maximum: 9, target: 9, migrations: [] },
    controllers: [{ type: 'azure-devops', minimumVersion: '1.0.0' }],
    targets: ['azure-container-apps'],
  },
};

function application(user: SessionUserDto = { login: 'owner@example.test', role: 'owner' }) {
  const instance = new Hono<AppContext>();
  instance.use('*', async (c, next) => { c.set('user', user); await next(); });
  instance.route('/api/v1/admin/updates', upgradeRoutes);
  return instance;
}

function environment(db: D1Database): Env {
  return {
    DB: db, ASSETS: {}, DEMO_MODE: 'false', SESSION_SECRET: 'session-secret',
    APP_VERSION: 'v1.0.23', PUBLIC_BASE_URL: 'https://wrangler.example.test',
    UPGRADE_DEPLOYMENT_TARGET: 'hcs-production',
    UPGRADE_RELEASE_TARGET: 'azure-container-apps', UPGRADE_RELEASE_CHANNEL: 'stable',
    UPGRADE_RELEASE_MANIFEST_URL: 'https://releases.example.test/manifest.json',
    UPGRADE_SCHEMA_VERSION: '9', UPGRADE_CURRENT_IMAGE_DIGEST: sourceDigest,
    UPGRADE_CONTROLLER_TYPE: 'azure-devops', UPGRADE_CONTROLLER_VERSION: '1.0.0',
    AZURE_DEVOPS_ORGANIZATION: 'hybridcloudsolutions', AZURE_DEVOPS_PROJECT: 'WranglerLabs',
    AZURE_DEVOPS_PIPELINE_ID: '42', AZURE_DEVOPS_PIPELINE_REF: 'refs/heads/main',
    AZURE_DEVOPS_PIPELINE_NAME: 'RepoWrangler Production Upgrade',
    AZURE_CLIENT_ID: 'managed-identity', IDENTITY_ENDPOINT: 'http://identity/token',
    IDENTITY_HEADER: 'platform-header',
  } as unknown as Env;
}

function providerFetch() {
  let run = 700;
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url.startsWith('https://releases.example.test/')) return Response.json(manifest);
    if (url.startsWith('http://identity/')) {
      return Response.json({ access_token: 'opaque-managed-identity-token', expires_on: '9999999999' });
    }
    if (url.includes('/_apis/pipelines/42/runs')) {
      if (!init?.method) return Response.json({
        id: 701,
        state: controllerCheckpoint?.state === 'completed' ? 'completed' : 'inProgress',
        result: controllerCheckpoint?.state === 'completed' ? 'succeeded' : undefined,
      });
      const body = JSON.parse(String(init?.body)) as { previewRun?: boolean };
      if (body.previewRun) return Response.json({ finalYaml: controllerPreviewYaml });
      run += 1;
      return Response.json({ id: run, state: 'inProgress', createdDate: '2026-09-05T00:00:00Z' });
    }
    if (url.includes('/_apis/pipelines/42?')) {
      return Response.json({ id: 42, name: 'RepoWrangler Production Upgrade' });
    }
    if (url.includes('/properties')) return Response.json(controllerCheckpoint ? {
      value: {
        'RepoWrangler.UpgradeCheckpoint': {
          $type: 'System.String', $value: JSON.stringify(controllerCheckpoint),
        },
      },
    } : { value: {} });
    if (url.includes('/timeline')) return Response.json({ records: [] });
    if (url.includes('/_apis/build/builds/') && init?.method === 'PATCH') {
      return Response.json({ status: 'cancelling' });
    }
    return new Response('not found', { status: 404 });
  });
}

describe('Administration Updates API', () => {
  let db: D1Database;
  let env: Env;

  beforeEach(() => {
    const opened = openSqliteD1(':memory:');
    applyMigrations(opened.raw, migrationsDir);
    db = opened.d1 as unknown as D1Database;
    env = environment(db);
    controllerCheckpoint = undefined;
    controllerPreviewYaml = 'stages: []';
    vi.stubGlobal('fetch', providerFetch());
  });

  it('shows an evaluated immutable update and controller capability', async () => {
    const response = await application().request('/api/v1/admin/updates', {}, env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      installedVersion: 'v1.0.23', channel: 'stable',
      deploymentTarget: 'hcs-production',
      evaluation: { status: 'update_available', availableVersion: 'v1.0.24', imageDigest: targetDigest },
      controller: { availability: 'available', controllerType: 'azure-devops' },
      jobs: [], auditEvents: [],
    });
  });

  it('requires an exact origin and explicit target-bound confirmation', async () => {
    const noOrigin = await application().request('/api/v1/admin/updates/prepare', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetVersion: 'v1.0.24', targetDigest }),
    }, env);
    expect(noOrigin.status).toBe(403);

    const prepared = await application().request('/api/v1/admin/updates/prepare', {
      method: 'POST', headers: {
        'content-type': 'application/json', origin: 'https://wrangler.example.test',
      },
      body: JSON.stringify({ targetVersion: 'v1.0.24', targetDigest }),
    }, env);
    expect(prepared.status).toBe(200);
    const confirmation = await prepared.json() as { approvalToken: string };
    expect(confirmation.approvalToken).toBeTruthy();
    expect(JSON.stringify(confirmation)).not.toContain('opaque-managed-identity-token');

    const requested = await application().request('/api/v1/admin/updates/request', {
      method: 'POST', headers: {
        'content-type': 'application/json', origin: 'https://wrangler.example.test',
      },
      body: JSON.stringify({
        targetVersion: 'v1.0.24', targetDigest,
        approvalToken: confirmation.approvalToken,
        idempotencyKey: 'browser-generated-request-1',
      }),
    }, env);
    expect(requested.status).toBe(202);
    const first = await requested.json() as { job: { id: string; state: string } };
    expect(first.job.state).toBe('accepted');

    const replay = await application().request('/api/v1/admin/updates/request', {
      method: 'POST', headers: {
        'content-type': 'application/json', origin: 'https://wrangler.example.test',
      },
      body: JSON.stringify({
        targetVersion: 'v1.0.24', targetDigest,
        approvalToken: confirmation.approvalToken,
        idempotencyKey: 'browser-generated-request-1',
      }),
    }, env);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ replayed: true, job: { id: first.job.id } });

    const events = await db.prepare(
      'SELECT action, detail FROM audit_events WHERE action LIKE ?1 ORDER BY created_at',
    ).bind('upgrade.%').all<{ action: string; detail: string }>();
    expect(events.results.map((event) => event.action)).toEqual([
      'upgrade.preflight.completed', 'upgrade.request.accepted',
    ]);
    expect(JSON.stringify(events.results)).not.toContain(confirmation.approvalToken);

    const status = await application().request('/api/v1/admin/updates', {}, env);
    const statusBody = await status.json() as { auditEvents: Array<{ action: string }> };
    expect(statusBody.auditEvents.map((event) => event.action).sort()).toEqual([
      'upgrade.preflight.completed', 'upgrade.request.accepted',
    ]);
  });

  it('does not mint an execution approval when controller preflight fails', async () => {
    controllerPreviewYaml = undefined;
    const response = await application().request('/api/v1/admin/updates/prepare', {
      method: 'POST', headers: {
        'content-type': 'application/json', origin: 'https://wrangler.example.test',
      },
      body: JSON.stringify({ targetVersion: 'v1.0.24', targetDigest }),
    }, env);

    expect(response.status).toBe(409);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      error: 'controller_preflight_failed',
      preflight: { ready: false },
    });
    expect(body).not.toHaveProperty('approvalToken');
    const audit = await db.prepare(
      `SELECT action, detail FROM audit_events WHERE action = 'upgrade.preflight.rejected'`,
    ).first<{ action: string; detail: string }>();
    expect(audit?.detail).toContain('reason=controller_not_ready');
  });

  it('forbids viewers before release or controller access', async () => {
    const response = await application({ login: 'viewer', role: 'viewer' })
      .request('/api/v1/admin/updates', {}, env);
    expect(response.status).toBe(403);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('reconciles skipped safe checkpoints and requires a fresh approval for rollback', async () => {
    const app = application();
    const prepared = await app.request('/api/v1/admin/updates/prepare', {
      method: 'POST', headers: {
        'content-type': 'application/json', origin: 'https://wrangler.example.test',
      },
      body: JSON.stringify({ targetVersion: 'v1.0.24', targetDigest }),
    }, env);
    const confirmation = await prepared.json() as { approvalToken: string };
    const requested = await app.request('/api/v1/admin/updates/request', {
      method: 'POST', headers: {
        'content-type': 'application/json', origin: 'https://wrangler.example.test',
      },
      body: JSON.stringify({
        targetVersion: 'v1.0.24', targetDigest,
        approvalToken: confirmation.approvalToken,
        idempotencyKey: 'browser-generated-request-rollback',
      }),
    }, env);
    const accepted = await requested.json() as { job: { id: string } };
    controllerCheckpoint = {
      schemaVersion: '1.0', pipelineId: 42, runId: 701, state: 'completed',
      observedAt: '2026-09-05T00:20:00Z',
      evidence: {
        backup: { verified: true, id: 'backup-1', completedAt: '2026-09-05T00:02:00Z' },
        migrationValidation: {
          verified: true, restoredDatabaseId: 'restore-1', sourceSchema: 9,
          targetSchema: 9, completedAt: '2026-09-05T00:05:00Z',
        },
        artifact: {
          digest: targetDigest, checksumVerified: true, provenanceVerified: true,
          signatureVerified: true, imageAvailable: true,
        },
        rollback: { available: true, revision: 'previous', imageDigest: sourceDigest },
        deployment: { revision: 'candidate', imageDigest: targetDigest, trafficPercent: 100 },
        health: { application: true, schema: true, checkedAt: '2026-09-05T00:19:00Z' },
      },
    };
    const polled = await app.request(`/api/v1/admin/updates/jobs/${accepted.job.id}`, {}, env);
    expect(await polled.json()).toMatchObject({
      job: { state: 'completed' },
      events: [
        { toState: 'requested' }, { toState: 'accepted' }, { toState: 'preflight' },
        { toState: 'backup' }, { toState: 'validating_artifact' },
        { toState: 'deploying' }, { toState: 'verifying' }, { toState: 'completed' },
      ],
    });

    const rollbackPrepared = await app.request(
      `/api/v1/admin/updates/jobs/${accepted.job.id}/prepare-action`, {
        method: 'POST', headers: {
          'content-type': 'application/json', origin: 'https://wrangler.example.test',
        }, body: JSON.stringify({ action: 'rollback' }),
      }, env,
    );
    const rollbackApproval = await rollbackPrepared.json() as { approvalToken: string };
    const rolledBack = await app.request(`/api/v1/admin/updates/jobs/${accepted.job.id}/rollback`, {
      method: 'POST', headers: {
        'content-type': 'application/json', origin: 'https://wrangler.example.test',
      }, body: JSON.stringify({ action: 'rollback', approvalToken: rollbackApproval.approvalToken }),
    }, env);
    expect(rolledBack.status).toBe(202);
    expect(await rolledBack.json()).toMatchObject({ job: { state: 'rollback_requested' } });
  });

  it('requires one-time explicit approval before canceling an accepted job', async () => {
    const app = application();
    const prepared = await app.request('/api/v1/admin/updates/prepare', {
      method: 'POST', headers: {
        'content-type': 'application/json', origin: 'https://wrangler.example.test',
      }, body: JSON.stringify({ targetVersion: 'v1.0.24', targetDigest }),
    }, env);
    const confirmation = await prepared.json() as { approvalToken: string };
    const requested = await app.request('/api/v1/admin/updates/request', {
      method: 'POST', headers: {
        'content-type': 'application/json', origin: 'https://wrangler.example.test',
      }, body: JSON.stringify({
        targetVersion: 'v1.0.24', targetDigest, approvalToken: confirmation.approvalToken,
        idempotencyKey: 'browser-generated-request-cancel',
      }),
    }, env);
    const accepted = await requested.json() as { job: { id: string } };
    const invalidRollback = await app.request(
      `/api/v1/admin/updates/jobs/${accepted.job.id}/prepare-action`, {
        method: 'POST', headers: {
          'content-type': 'application/json', origin: 'https://wrangler.example.test',
        }, body: JSON.stringify({ action: 'rollback' }),
      }, env,
    );
    expect(invalidRollback.status).toBe(409);
    expect(await invalidRollback.json()).toEqual({ error: 'action_not_available' });
    const cancelPrepared = await app.request(
      `/api/v1/admin/updates/jobs/${accepted.job.id}/prepare-action`, {
        method: 'POST', headers: {
          'content-type': 'application/json', origin: 'https://wrangler.example.test',
        }, body: JSON.stringify({ action: 'cancel' }),
      }, env,
    );
    const approval = await cancelPrepared.json() as { approvalToken: string };
    const canceled = await app.request(`/api/v1/admin/updates/jobs/${accepted.job.id}/cancel`, {
      method: 'POST', headers: {
        'content-type': 'application/json', origin: 'https://wrangler.example.test',
      }, body: JSON.stringify({ action: 'cancel', approvalToken: approval.approvalToken }),
    }, env);
    expect(canceled.status).toBe(202);
    expect(await canceled.json()).toMatchObject({ job: { state: 'cancel_requested' } });
  });
});
