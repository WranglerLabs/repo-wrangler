import { Hono } from 'hono';
import type {
  ConnectionDto,
  ConnectionSecretHintDto,
  ConnectionWorkspaceDto,
  ConnectResultDto,
  GitLabGroupSearchResultDto,
  OnboardingStatusDto,
} from '@repo-wrangler/contracts';
import {
  countMonitoredWorkspaces,
  deleteAllConnectionSecrets,
  ensureGitHubConnection,
  ensureGitLabConnection,
  enqueueSyncJob,
  getConnectionById,
  getWorkspaceMonitoringState,
  listConnections,
  listConnectionSecretHints,
  listWorkspacesForConnection,
  markConnectionRemoved,
  recordAuditEvent,
  setConnectionAppSlug,
  setConnectionSecretReference,
  updateConnectionDisplayName,
  upsertWorkspace,
} from '@repo-wrangler/persistence-d1';
import {
  getInstallationToken,
  listInstallationRepositories,
  listInstallations,
  mapInstallationToWorkspace,
} from '@repo-wrangler/provider-github';
import { GitLabClient, countGroupProjects, getGroupWorkspace, searchGroups } from '@repo-wrangler/provider-gitlab';
import { isDemoMode } from '../bindings';
import { isSetupMode } from '../auth/registry';
import { requireAdmin, type AppContext } from '../middleware/auth';
import {
  resolveGitHubAppCredentials,
  resolveGitLabCredentials,
  writableConnectionSecretProvider,
} from '../lib/connection-secrets';

/**
 * Onboarding design B1/B3 — first-run detection, the connect wizard's API,
 * and credential rotation (Credential entry). Mounted under `/api/v1`
 * alongside `apiRoutes`, behind the same `requireAuth` (index.ts).
 */
export const connectionRoutes = new Hono<AppContext>();

// ---------------------------------------------------------------------------
// B1 — first-run detection
// ---------------------------------------------------------------------------

connectionRoutes.get('/onboarding/status', async (c) => {
  if (isDemoMode(c.env)) {
    const body: OnboardingStatusDto = {
      demo: true,
      setupMode: false,
      setupTokenRequired: false,
      connections: 0,
      monitoredWorkspaces: 0,
      firstRun: false,
    };
    return c.json(body);
  }
  const connections = await listConnections(c.env.DB);
  const monitoredWorkspaces = await countMonitoredWorkspaces(c.env.DB);
  const setupMode = await isSetupMode(c.env);
  const body: OnboardingStatusDto = {
    demo: false,
    setupMode,
    setupTokenRequired: setupMode && Boolean(c.env.SETUP_TOKEN),
    connections: connections.length,
    monitoredWorkspaces,
    firstRun: monitoredWorkspaces === 0,
  };
  return c.json(body);
});

/** For the wizard's own connect step and the B5 estate-scope screen. */
connectionRoutes.get('/connections', requireAdmin, async (c) => {
  if (isDemoMode(c.env)) return c.json([] satisfies ConnectionDto[]);
  const rows = await listConnections(c.env.DB);
  const body: ConnectionDto[] = rows.map((r) => ({
    id: r.id,
    provider: r.provider_type,
    displayName: r.display_name,
    status: r.status,
    baseUrl: r.base_url ?? undefined,
    lastSuccessAt: r.last_success_at ?? undefined,
    lastErrorCode: r.last_error_code ?? undefined,
    appSlug: r.app_slug ?? undefined,
    installUrl: r.app_slug ? `https://github.com/apps/${r.app_slug}/installations/new` : undefined,
  }));
  return c.json(body);
});

// ---------------------------------------------------------------------------
// B3 — connect API
// ---------------------------------------------------------------------------

interface GitHubManifestConversion {
  id: number;
  slug: string;
  pem: string;
  webhook_secret: string;
  client_id: string;
  client_secret: string;
}

/** The GitHub App manifest flow's automated half (B2/B3) — no copy/paste. */
connectionRoutes.post('/connections/github/exchange', requireAdmin, async (c) => {
  if (isDemoMode(c.env)) return c.json({ error: 'not available in demo mode' }, 409);
  let body: { code?: string };
  try {
    body = await c.req.json<{ code?: string }>();
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400);
  }
  const code = body.code?.trim();
  if (!code) return c.json({ error: 'code is required' }, 400);
  if (!c.env.SECRET_ENCRYPTION_KEY) {
    return c.json({ error: 'SECRET_ENCRYPTION_KEY is not configured.' }, 500);
  }

  const response = await fetch(
    `https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`,
    { method: 'POST', headers: { accept: 'application/vnd.github+json', 'user-agent': 'repo-wrangler' } },
  );
  if (!response.ok) {
    return c.json({ error: 'GitHub rejected the setup code — it may be expired or already used.' }, 400);
  }
  const manifest = (await response.json()) as GitHubManifestConversion;
  if (!manifest.id || !manifest.pem) {
    return c.json({ error: 'GitHub did not return app credentials.' }, 502);
  }

  const connectionId = await ensureGitHubConnection(c.env.DB);
  const stored = await persistGitHubCredentials(c, connectionId, {
    appId: String(manifest.id),
    privateKey: manifest.pem,
    webhookSecret: manifest.webhook_secret,
    clientId: manifest.client_id,
    clientSecret: manifest.client_secret,
  });
  if (!stored.ok) return c.json({ error: stored.error }, 500);
  await updateConnectionDisplayName(c.env.DB, connectionId, `GitHub App — ${manifest.slug}`);
  await setConnectionAppSlug(c.env.DB, connectionId, manifest.slug);

  const user = c.get('user');
  await recordAuditEvent(c.env.DB, user.login, 'connection.github.created', `slug=${manifest.slug}`);

  // A connection with credentials but no installation yet still has nothing
  // to discover, but this keeps the estate current the moment an
  // installation does land, without the operator having to find the admin
  // sync button (wizard-loop fix — discovery no longer waits on a manual trigger).
  await enqueueSyncJob(c.env.DB, 'discovery', 'all', 2);

  const result: ConnectResultDto = {
    connectionId,
    appSlug: manifest.slug,
    installUrl: `https://github.com/apps/${manifest.slug}/installations/new`,
  };
  return c.json(result);
});

/** For operators who already have a GitHub App and would rather paste its credentials. */
connectionRoutes.post('/connections/github/credentials', requireAdmin, async (c) => {
  if (isDemoMode(c.env)) return c.json({ error: 'not available in demo mode' }, 409);
  let body: {
    appId?: string;
    privateKey?: string;
    webhookSecret?: string;
    clientId?: string;
    clientSecret?: string;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400);
  }
  const appId = body.appId?.trim();
  const privateKey = body.privateKey?.trim();
  const webhookSecret = body.webhookSecret?.trim();
  if (!appId || !privateKey || !webhookSecret) {
    return c.json({ error: 'appId, privateKey, and webhookSecret are required' }, 400);
  }
  if (!c.env.SECRET_ENCRYPTION_KEY) {
    return c.json({ error: 'SECRET_ENCRYPTION_KEY is not configured.' }, 500);
  }

  const connectionId = await ensureGitHubConnection(c.env.DB);
  const stored = await persistGitHubCredentials(c, connectionId, {
    appId,
    privateKey,
    webhookSecret,
    clientId: body.clientId?.trim(),
    clientSecret: body.clientSecret?.trim(),
  });
  if (!stored.ok) return c.json({ error: stored.error }, 500);

  const user = c.get('user');
  await recordAuditEvent(c.env.DB, user.login, 'connection.github.credentials_pasted');
  await enqueueSyncJob(c.env.DB, 'discovery', 'all', 2);

  const result: ConnectResultDto = { connectionId };
  return c.json(result);
});

async function persistGitHubCredentials(
  c: { env: AppContext['Bindings'] },
  connectionId: string,
  values: {
    appId: string;
    privateKey: string;
    webhookSecret: string;
    clientId?: string;
    clientSecret?: string;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  let secrets;
  try {
    secrets = await writableConnectionSecretProvider(c.env, c.env.DB, connectionId);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'secret storage is not configured' };
  }
  await secrets.set('GITHUB_APP_ID', values.appId);
  await secrets.set('GITHUB_APP_PRIVATE_KEY', values.privateKey);
  await secrets.set('GITHUB_WEBHOOK_SECRET', values.webhookSecret);
  if (values.clientId) await secrets.set('GITHUB_CLIENT_ID', values.clientId);
  if (values.clientSecret) await secrets.set('GITHUB_CLIENT_SECRET', values.clientSecret);
  await setConnectionSecretReference(c.env.DB, connectionId, connectionId);
  return { ok: true };
}

/** Discovered installations/groups for the connect step's monitor-toggle list. */
connectionRoutes.get('/connections/:id/workspaces', requireAdmin, async (c) => {
  const id = c.req.param('id');
  const connection = await getConnectionById(c.env.DB, id);
  if (!connection) return c.json({ error: 'not found' }, 404);

  if (connection.provider_type === 'github') {
    const credentials = await resolveGitHubAppCredentials(c.env, c.env.DB);
    if (!credentials) {
      return c.json({ error: 'GitHub App credentials are not configured for this connection.' }, 409);
    }
    let installations;
    try {
      installations = await listInstallations(credentials.appId, credentials.privateKey);
    } catch {
      return c.json({ error: 'Could not list GitHub App installations.' }, 502);
    }
    const body: ConnectionWorkspaceDto[] = [];
    for (const installation of installations) {
      const snapshot = mapInstallationToWorkspace(installation);
      const workspaceId = await upsertWorkspace(c.env.DB, id, snapshot);
      const state = (await getWorkspaceMonitoringState(c.env.DB, workspaceId)) ?? 'monitored';
      let repoCount: number | undefined;
      try {
        const token = await getInstallationToken(credentials.appId, credentials.privateKey, installation.id);
        const page = await listInstallationRepositories(token, 1);
        repoCount = page.totalCount ?? page.repositories.length;
      } catch {
        repoCount = undefined;
      }
      body.push({
        id: workspaceId,
        slug: snapshot.slug,
        displayName: snapshot.displayName,
        kind: snapshot.kind,
        monitoringState: state,
        repoCount,
      });
    }
    return c.json(body);
  }

  if (connection.provider_type === 'gitlab') {
    const rows = await listWorkspacesForConnection(c.env.DB, id);
    const body: ConnectionWorkspaceDto[] = rows.map((w) => ({
      id: w.id,
      slug: w.slug,
      displayName: w.display_name ?? undefined,
      kind: w.kind,
      monitoringState: w.monitoring_state,
    }));
    return c.json(body);
  }

  return c.json([] satisfies ConnectionWorkspaceDto[]);
});

/** Validate the token, persist it, and create the (single, v1) GitLab connection. */
connectionRoutes.post('/connections/gitlab', requireAdmin, async (c) => {
  if (isDemoMode(c.env)) return c.json({ error: 'not available in demo mode' }, 409);
  let body: { baseUrl?: string; token?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400);
  }
  let parsedBaseUrl: URL;
  try {
    parsedBaseUrl = new URL(body.baseUrl?.trim() || 'https://gitlab.com');
  } catch {
    return c.json({ error: 'GitLab base URL must be a valid http(s) origin.' }, 400);
  }
  if (
    !['http:', 'https:'].includes(parsedBaseUrl.protocol) ||
    parsedBaseUrl.username ||
    parsedBaseUrl.password ||
    (parsedBaseUrl.pathname !== '/' && parsedBaseUrl.pathname !== '') ||
    parsedBaseUrl.search ||
    parsedBaseUrl.hash
  ) {
    return c.json({ error: 'GitLab base URL must contain only scheme, host, and optional port.' }, 400);
  }
  const baseUrl = parsedBaseUrl.origin;
  const token = body.token?.trim();
  if (!token) return c.json({ error: 'token is required' }, 400);

  const user = c.get('user');
  if (user.provider === 'setup' && !c.env.SETUP_TOKEN && parsedBaseUrl.hostname !== 'gitlab.com') {
    return c.json(
      { error: 'Custom GitLab origins require SETUP_TOKEN during unauthenticated first boot.' },
      400,
    );
  }

  const client = new GitLabClient(token, baseUrl);
  const check = await client.request<{ username?: string }>('/user');
  if (!check.ok || !check.data?.username) {
    return c.json({ error: 'token rejected by GitLab' }, 400);
  }
  if (!c.env.SECRET_ENCRYPTION_KEY) {
    return c.json({ error: 'SECRET_ENCRYPTION_KEY is not configured.' }, 500);
  }

  const connectionId = await ensureGitLabConnection(c.env.DB, baseUrl);
  let secrets;
  try {
    secrets = await writableConnectionSecretProvider(c.env, c.env.DB, connectionId);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'secret storage is not configured' }, 500);
  }
  await secrets.set('GITLAB_TOKEN', token);
  await setConnectionSecretReference(c.env.DB, connectionId, connectionId);

  await recordAuditEvent(c.env.DB, user.login, 'connection.gitlab.created', `user=${check.data.username}`);
  // B11: 'discovery' is the GitHub reconciliation job — a fresh GitLab
  // connection must enqueue its own job type or no scan ever runs until the
  // 03:17 UTC maintenance tick happens to fire.
  await enqueueSyncJob(c.env.DB, 'gitlab_discovery', 'all', 2);

  const result: ConnectResultDto = { connectionId };
  return c.json(result);
});

/** Server-side proxy to GitLab Groups search — the token never leaves the server. */
connectionRoutes.get('/connections/:id/search-groups', requireAdmin, async (c) => {
  const id = c.req.param('id');
  const connection = await getConnectionById(c.env.DB, id);
  if (!connection || connection.provider_type !== 'gitlab') return c.json({ error: 'not found' }, 404);
  const q = c.req.query('q')?.trim() ?? '';
  if (!q) return c.json([] satisfies GitLabGroupSearchResultDto[]);

  const credentials = await resolveGitLabCredentials(c.env, c.env.DB);
  if (!credentials) return c.json({ error: 'GitLab is not configured for this connection.' }, 409);
  const client = new GitLabClient(credentials.token, credentials.baseUrl);
  try {
    const groups = await searchGroups(client, q);
    return c.json(groups satisfies GitLabGroupSearchResultDto[]);
  } catch {
    return c.json({ error: 'GitLab group search failed.' }, 502);
  }
});

/** Create monitored workspace rows for the selected GitLab groups (B4 reads these). */
connectionRoutes.post('/connections/:id/workspaces', requireAdmin, async (c) => {
  if (isDemoMode(c.env)) return c.json({ error: 'not available in demo mode' }, 409);
  const id = c.req.param('id');
  const connection = await getConnectionById(c.env.DB, id);
  if (!connection || connection.provider_type !== 'gitlab') return c.json({ error: 'not found' }, 404);

  let body: { externalIds?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400);
  }
  const groupPaths = Array.isArray(body.externalIds)
    ? body.externalIds.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    : [];
  if (groupPaths.length === 0) return c.json({ error: 'externalIds is required' }, 400);

  const credentials = await resolveGitLabCredentials(c.env, c.env.DB);
  if (!credentials) return c.json({ error: 'GitLab is not configured for this connection.' }, 409);
  const client = new GitLabClient(credentials.token, credentials.baseUrl);

  const created: ConnectionWorkspaceDto[] = [];
  for (const groupPath of groupPaths) {
    let snapshot;
    try {
      snapshot = await getGroupWorkspace(client, groupPath);
    } catch {
      continue; // Skip a path GitLab rejects rather than failing the whole selection.
    }
    const workspaceId = await upsertWorkspace(c.env.DB, id, snapshot);
    let repoCount: number | undefined;
    try {
      repoCount = await countGroupProjects(client, groupPath);
    } catch {
      repoCount = undefined;
    }
    created.push({
      id: workspaceId,
      slug: snapshot.slug,
      displayName: snapshot.displayName,
      kind: snapshot.kind,
      monitoringState: 'monitored',
      repoCount,
    });
  }

  const user = c.get('user');
  await recordAuditEvent(c.env.DB, user.login, 'connection.gitlab.workspaces_selected', groupPaths.join(','));
  // B11: selected groups should populate without waiting for a periodic tick.
  await enqueueSyncJob(c.env.DB, 'gitlab_discovery', 'all', 2);

  return c.json(created);
});

// ---------------------------------------------------------------------------
// Credential entry — replace/rotate and disconnect (B5 Credentials panel)
// ---------------------------------------------------------------------------

/** Presence + masked hint only — never the value. */
connectionRoutes.get('/connections/:id/credentials', requireAdmin, async (c) => {
  const id = c.req.param('id');
  const connection = await getConnectionById(c.env.DB, id);
  if (!connection) return c.json({ error: 'not found' }, 404);
  const namespace = connection.secret_reference ?? id;
  const hints = await listConnectionSecretHints(c.env.DB, namespace);
  const body: ConnectionSecretHintDto[] = hints.map((h) => ({
    name: h.name,
    present: true,
    hint: h.fingerprint ? `••••${h.fingerprint}` : undefined,
    updatedAt: h.updated_at,
  }));
  return c.json(body);
});

connectionRoutes.put('/connections/:id/credentials', requireAdmin, async (c) => {
  if (isDemoMode(c.env)) return c.json({ error: 'not available in demo mode' }, 409);
  const id = c.req.param('id');
  const connection = await getConnectionById(c.env.DB, id);
  if (!connection) return c.json({ error: 'not found' }, 404);

  let body: { name?: string; value?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400);
  }
  const name = body.name?.trim();
  const value = body.value;
  if (!name || !value) return c.json({ error: 'name and value are required' }, 400);

  // Connection id is stable across rotation — never re-created, monitoring
  // state never touched.
  const namespace = connection.secret_reference ?? id;
  let secrets;
  try {
    secrets = await writableConnectionSecretProvider(c.env, c.env.DB, namespace);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'secret storage is not configured' }, 500);
  }
  await secrets.set(name, value);
  if (!connection.secret_reference) await setConnectionSecretReference(c.env.DB, id, namespace);

  const user = c.get('user');
  await recordAuditEvent(c.env.DB, user.login, 'connection.credential.rotate', `connection=${id} name=${name}`);

  const hints = await listConnectionSecretHints(c.env.DB, namespace);
  const updated = hints.find((h) => h.name === name);
  return c.json({
    name,
    updatedAt: updated?.updated_at,
    hint: updated?.fingerprint ? `••••${updated.fingerprint}` : undefined,
  });
});

/** Tombstone the connection and delete every secret in its namespace. */
connectionRoutes.delete('/connections/:id', requireAdmin, async (c) => {
  if (isDemoMode(c.env)) return c.json({ error: 'not available in demo mode' }, 409);
  const id = c.req.param('id');
  const connection = await getConnectionById(c.env.DB, id);
  if (!connection) return c.json({ error: 'not found' }, 404);

  const namespace = connection.secret_reference ?? id;
  await deleteAllConnectionSecrets(c.env.DB, namespace);
  await markConnectionRemoved(c.env.DB, id);

  const user = c.get('user');
  await recordAuditEvent(c.env.DB, user.login, 'connection.disconnect', `connection=${id}`);

  return c.json({ ok: true });
});
