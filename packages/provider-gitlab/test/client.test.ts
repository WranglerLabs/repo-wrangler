import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitLabClient, inspectGitLabToken } from '../src/client';

function respond(body: unknown, status = 200) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  })));
}

afterEach(() => vi.unstubAllGlobals());

describe('GitLab token capability inspection', () => {
  it('verifies standard read_api scope and captures expiry', async () => {
    respond({ active: true, scopes: ['read_api'], expires_at: '2027-01-01' });
    await expect(inspectGitLabToken(new GitLabClient('token'))).resolves.toEqual({
      status: 'read_scope_verified',
      details: {
        active: 'true', standardScopes: 'read_api', granularPermissions: 'none_reported',
        expiresAt: '2027-01-01',
      },
    });
  });

  it('flags broad or write credentials instead of presenting them as read-only', async () => {
    respond({ active: true, scopes: ['api'], granular_scopes: [
      { permissions: ['read_project', 'delete_project'] },
    ] });
    await expect(inspectGitLabToken(new GitLabClient('token'))).resolves.toMatchObject({
      status: 'write_scope_detected',
      details: { standardScopes: 'api', granularPermissions: 'delete_project,read_project' },
    });
  });

  it('reports inactive and insufficient credentials explicitly', async () => {
    respond({ active: false, revoked: true, scopes: ['read_api'] });
    await expect(inspectGitLabToken(new GitLabClient('token'))).resolves.toMatchObject({
      status: 'token_inactive', details: { active: 'false' },
    });

    respond({ active: true, scopes: ['read_user'] });
    await expect(inspectGitLabToken(new GitLabClient('token'))).resolves.toMatchObject({
      status: 'insufficient_read_scope',
    });
  });

  it('keeps unsupported self-managed introspection distinct from verified access', async () => {
    respond({ message: '404 Not Found' }, 404);
    await expect(inspectGitLabToken(new GitLabClient('token'))).resolves.toEqual({
      status: 'token_introspection_unavailable', details: { introspection: 'http_404' },
    });
  });
});
