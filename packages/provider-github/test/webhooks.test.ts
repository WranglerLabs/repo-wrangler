import { describe, expect, it } from 'vitest';
import { translateGitHubEvent, verifyGitHubSignature } from '../src/webhooks';

async function sign(secret: string, body: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(body)));
  return `sha256=${Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

describe('verifyGitHubSignature', () => {
  it('accepts a valid signature and rejects a tampered body', async () => {
    const secret = 'test-secret';
    const body = JSON.stringify({ zen: 'Keep it logically awesome.' });
    const header = await sign(secret, body);
    expect(await verifyGitHubSignature(secret, body, header)).toBe(true);
    expect(await verifyGitHubSignature(secret, body + ' ', header)).toBe(false);
    expect(await verifyGitHubSignature(secret, body, null)).toBe(false);
    expect(await verifyGitHubSignature(secret, body, 'sha256=zz')).toBe(false);
  });
});

const repoPayload = {
  repository: {
    id: 101,
    node_id: 'R_101',
    name: 'demo',
    full_name: 'acme/demo',
    private: false,
    html_url: 'https://github.com/acme/demo',
    default_branch: 'main',
    owner: { id: 7, login: 'acme' },
    archived: false,
    fork: false,
    topics: ['ops'],
  },
};

describe('translateGitHubEvent', () => {
  it('drops unhandled events', () => {
    expect(translateGitHubEvent('star', { action: 'created' })).toEqual([]);
  });

  it('translates repository created into repository.upsert', () => {
    const events = translateGitHubEvent('repository', { action: 'created', ...repoPayload });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'repository.upsert',
      ref: { workspaceExternalId: '7', repositoryExternalId: '101', fullName: 'acme/demo' },
    });
  });

  it('translates repository deleted into repository.removed', () => {
    const events = translateGitHubEvent('repository', { action: 'deleted', ...repoPayload });
    expect(events[0]?.type).toBe('repository.removed');
  });

  it('translates a branch push into branch.pushed plus a follow-up sync request', () => {
    const events = translateGitHubEvent('push', {
      ...repoPayload,
      ref: 'refs/heads/feature/x',
      after: 'abc123',
      deleted: false,
    });
    expect(events.map((e) => e.type)).toEqual(['branch.pushed', 'sync.requested']);
  });

  it('ignores tag pushes', () => {
    const events = translateGitHubEvent('push', {
      ...repoPayload,
      ref: 'refs/tags/v1.0.0',
      after: 'abc123',
    });
    expect(events).toEqual([]);
  });

  it('translates workflow_run into pipeline_run.upsert', () => {
    const events = translateGitHubEvent('workflow_run', {
      ...repoPayload,
      workflow_run: {
        id: 555,
        name: 'ci',
        status: 'completed',
        conclusion: 'failure',
        head_branch: 'main',
        head_sha: 'abc',
        run_started_at: '2026-07-12T00:00:00Z',
        updated_at: '2026-07-12T00:05:00Z',
      },
    });
    expect(events[0]).toMatchObject({
      type: 'pipeline_run.upsert',
      run: { externalId: '555', conclusion: 'failure', durationSeconds: 300 },
    });
  });

  it('redacts secret scanning alerts to metadata only', () => {
    const events = translateGitHubEvent('secret_scanning_alert', {
      ...repoPayload,
      action: 'created',
      alert: {
        number: 9,
        state: 'open',
        secret_type: 'github_pat',
        secret_type_display_name: 'GitHub Personal Access Token',
        html_url: 'https://github.com/acme/demo/security/secret-scanning/9',
        created_at: '2026-07-12T00:00:00Z',
      },
    });
    const event = events[0];
    expect(event?.type).toBe('security_finding.upsert');
    if (event?.type === 'security_finding.upsert') {
      expect(event.finding.category).toBe('secret_scanning');
      expect(JSON.stringify(event.finding)).not.toContain('ghp_');
    }
  });
});
