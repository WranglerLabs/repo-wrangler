import { describe, expect, it, vi } from 'vitest';
import {
  AzureDevOpsManagedIdentityTokenProvider,
  AzureDevOpsUpgradeController,
  type AccessTokenProvider,
} from '../src';

const tokenProvider: AccessTokenProvider = {
  getToken: async () => ({ token: 'opaque-entra-token', expiresAt: 9999999999 }),
};

const request = {
  correlationId: 'correlation-1', idempotencyKey: 'request-1',
  deploymentTarget: 'hcs-production', sourceVersion: 'v1.0.23',
  sourceDigest: `sha256:${'a'.repeat(64)}`, targetVersion: 'v1.0.24',
  targetDigest: `sha256:${'b'.repeat(64)}`, rollbackVersion: 'v1.0.23',
  rollbackDigest: `sha256:${'a'.repeat(64)}`,
  actor: { id: 'owner@example.test', role: 'owner' as const },
};

describe('Azure DevOps upgrade controller', () => {
  it('uses a short-lived managed-identity token for the Azure DevOps resource', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({
      access_token: 'opaque', expires_on: '9999999999',
    }));
    const provider = new AzureDevOpsManagedIdentityTokenProvider({
      identityEndpoint: 'http://localhost/identity', identityHeader: 'platform-header',
      clientId: 'identity-client', fetcher, now: () => 100,
    });
    await expect(provider.getToken()).resolves.toEqual({ token: 'opaque', expiresAt: 9999999999 });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toContain('resource=https%3A%2F%2Fapp.vssps.visualstudio.com');
    expect(String(url)).toContain('client_id=identity-client');
    expect(init?.headers).toMatchObject({ 'X-IDENTITY-HEADER': 'platform-header' });
  });

  it('previews the approved private pipeline without creating a run', async () => {
    const fetcher = vi.fn<typeof fetch>(async (url, _init) => {
      if (String(url).includes('/runs')) return Response.json({ finalYaml: 'stages: []' });
      return Response.json({ name: 'RepoWrangler Production Upgrade' });
    });
    const controller = new AzureDevOpsUpgradeController({
      organization: 'hybridcloudsolutions', project: 'WranglerLabs', pipelineId: 42,
      controllerVersion: '1.0.0', expectedPipelineName: 'RepoWrangler Production Upgrade',
      pipelineRef: 'refs/heads/main', tokenProvider, fetcher,
      now: () => '2026-09-04T00:00:00.000Z',
    });
    await expect(controller.preflight(request)).resolves.toMatchObject({ ready: true });
    const body = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body));
    expect(body).toMatchObject({
      previewRun: true,
      resources: { repositories: { self: { refName: 'refs/heads/main' } } },
      templateParameters: {
        operation: 'preflight', targetDigest: request.targetDigest,
        deploymentTarget: 'hcs-production', actorId: 'owner@example.test',
      },
    });
  });

  it('queues a digest-bound run and returns only safe controller evidence', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({
      id: 700, state: 'inProgress', createdDate: '2026-09-04T00:00:00Z',
      url: 'https://dev.azure.com/org/project/_apis/pipelines/42/runs/700',
    }));
    const controller = new AzureDevOpsUpgradeController({
      organization: 'hybridcloudsolutions', project: 'WranglerLabs', pipelineId: 42,
      controllerVersion: '1.0.0', tokenProvider, fetcher,
    });
    await expect(controller.request(request)).resolves.toMatchObject({
      controllerCorrelationId: '700', evidence: { pipelineId: 42, runId: 700 },
    });
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(body.templateParameters).toMatchObject({
      operation: 'upgrade', correlationId: 'correlation-1',
      targetVersion: 'v1.0.24', targetDigest: request.targetDigest,
    });
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({
      authorization: 'Bearer opaque-entra-token',
    });
  });

  it('maps checkpoint stages and never claims completion before evidence validation', async () => {
    const fetcher = vi.fn<typeof fetch>(async (url) => String(url).includes('timeline')
      ? Response.json({ records: [{ type: 'Stage', name: 'Deploy', state: 'inProgress', order: 4 }] })
      : Response.json({ id: 700, state: 'inProgress' }));
    const controller = new AzureDevOpsUpgradeController({
      organization: 'hybridcloudsolutions', project: 'WranglerLabs', pipelineId: 42,
      controllerVersion: '1.0.0', tokenProvider, fetcher,
      now: () => '2026-09-04T00:00:00.000Z',
    });
    await expect(controller.status('700')).resolves.toMatchObject({ state: 'deploying' });

    fetcher.mockImplementation(async () => Response.json({ id: 700, state: 'completed', result: 'succeeded' }));
    await expect(controller.status('700')).resolves.toMatchObject({ state: 'verifying' });
  });

  it('reads cumulative safety evidence from build properties without an inbound callback secret', async () => {
    const evidence = {
      backup: { verified: true, id: 'restore-point-7', completedAt: '2026-09-04T00:05:00Z' },
      migrationValidation: {
        verified: true, restoredDatabaseId: 'restore-test-7', sourceSchema: 9,
        targetSchema: 10, completedAt: '2026-09-04T00:10:00Z',
      },
    };
    const checkpoint = JSON.stringify({
      schemaVersion: '1.0', pipelineId: 42, runId: 700, state: 'validating_artifact',
      observedAt: '2026-09-04T00:11:00Z', evidence,
    });
    const fetcher = vi.fn<typeof fetch>(async (url) => {
      if (String(url).includes('/properties')) return Response.json({
        value: { 'RepoWrangler.UpgradeCheckpoint': { $type: 'System.String', $value: checkpoint } },
      });
      if (String(url).includes('/timeline')) return Response.json({ records: [] });
      return Response.json({ id: 700, state: 'inProgress' });
    });
    const controller = new AzureDevOpsUpgradeController({
      organization: 'hybridcloudsolutions', project: 'WranglerLabs', pipelineId: 42,
      controllerVersion: '1.0.0', tokenProvider, fetcher,
    });
    await expect(controller.status('700')).resolves.toMatchObject({
      state: 'validating_artifact', observedAt: '2026-09-04T00:11:00Z', evidence,
    });
    expect(fetcher.mock.calls.some(([url]) => String(url).includes(
      '/build/builds/700/properties?filter=RepoWrangler.UpgradeCheckpoint',
    ))).toBe(true);
  });
});
