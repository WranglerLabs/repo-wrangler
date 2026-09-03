/**
 * On-demand provider-credential resolution (ADR-021, onboarding design
 * "Credential entry"). Every discovery/enrichment/webhook call site that used
 * to read `env.GITHUB_APP_ID` etc. directly goes through here instead, so a
 * credential entered through the wizard is live on the very next job — no
 * restart. The `db` store is layered first (wizard-entered wins), the
 * boot-resolved env stays the fallback (the pre-seeded-env path never breaks).
 *
 * Resolution never creates a connection row — it only reads whatever
 * `ensureGitHubConnection`/`ensureGitLabConnection` (called elsewhere, once
 * credentials are known to exist) already created. A fresh, unconfigured
 * deployment therefore stays exactly as empty as it looks.
 */
// `/provider` and `/db` subpaths, not the full barrel — the Worker must
// never pull secrets-core's Node-only adapters (file/keyvault/vault/aws/gcp/…)
// into its `@cloudflare/workers-types`-only type graph.
import { EnvSecretProvider, type SecretProvider, type WritableSecretProvider } from '@repo-wrangler/secrets-core/provider';
import { DbSecretProvider, deriveEncryptionKey } from '@repo-wrangler/secrets-core/db';
import {
  D1ConnectionSecretStore,
  getConnectionById,
  listActiveConnectionsByType,
} from '@repo-wrangler/persistence-d1';
import type { Env } from '../bindings';

function envProvider(env: Env): SecretProvider {
  return new EnvSecretProvider(env as unknown as Record<string, string | undefined>);
}

/**
 * The composite a connection's secrets resolve through: `db` (namespaced to
 * `connectionId`) first, then env. When `SECRET_ENCRYPTION_KEY` is unset or no
 * connection id is known yet, this degrades to env-only — a GitOps deployment
 * that only ever pre-seeds env vars never needs the `db` store at all.
 */
export async function connectionSecretProvider(
  env: Env,
  db: D1Database,
  connectionId: string | null,
): Promise<SecretProvider> {
  const fallback = envProvider(env);
  if (!connectionId) return fallback;
  const connection = await getConnectionById(db, connectionId);
  const hasStoredSecrets = await db.prepare(
    'SELECT 1 AS present FROM connection_secrets WHERE secret_reference = ?1 LIMIT 1',
  ).bind(connectionId).first<{ present: number }>();
  // An environment-managed connection has no writable secret reference. A
  // database-managed connection must never borrow missing values from another
  // connection's process environment.
  if (!connection?.secret_reference && !hasStoredSecrets) return fallback;
  if (!env.SECRET_ENCRYPTION_KEY) {
    return { label: 'unavailable-db-secret-store', get: async () => undefined };
  }
  const key = await deriveEncryptionKey(env.SECRET_ENCRYPTION_KEY);
  return new DbSecretProvider(new D1ConnectionSecretStore(db), connectionId, key);
}

/**
 * The writable half — used by the connect/exchange/credential-rotation
 * endpoints to persist what the wizard collected. Throws if
 * `SECRET_ENCRYPTION_KEY` is missing: unlike the read path (which can safely
 * degrade to env-only), a write with nowhere durable to go must fail loudly.
 */
export async function writableConnectionSecretProvider(
  env: Env,
  db: D1Database,
  connectionId: string,
): Promise<WritableSecretProvider> {
  if (!env.SECRET_ENCRYPTION_KEY) {
    throw new Error('SECRET_ENCRYPTION_KEY is not configured.');
  }
  const key = await deriveEncryptionKey(env.SECRET_ENCRYPTION_KEY);
  return new DbSecretProvider(new D1ConnectionSecretStore(db), connectionId, key);
}

export interface GitHubAppCredentials {
  appId: string;
  privateKey: string;
  webhookSecret?: string;
  clientId?: string;
  clientSecret?: string;
}

/** Resolve one explicitly scoped GitHub App, or the environment set before a row exists. */
export async function resolveGitHubAppCredentials(
  env: Env,
  db: D1Database,
  connectionId?: string,
): Promise<GitHubAppCredentials | null> {
  const activeConnections = connectionId ? [] : await listActiveConnectionsByType(db, 'github');
  if (!connectionId && activeConnections.length > 1) return null;
  const connection = connectionId
    ? await getConnectionById(db, connectionId)
    : activeConnections[0] ?? null;
  if (connection && connection.provider_type !== 'github') return null;
  const provider = await connectionSecretProvider(env, db, connection?.id ?? null);
  const appId = await provider.get('GITHUB_APP_ID');
  const privateKey = await provider.get('GITHUB_APP_PRIVATE_KEY');
  if (!appId || !privateKey) return null;
  return {
    appId,
    privateKey,
    webhookSecret: await provider.get('GITHUB_WEBHOOK_SECRET'),
    clientId: await provider.get('GITHUB_CLIENT_ID'),
    clientSecret: await provider.get('GITHUB_CLIENT_SECRET'),
  };
}

export interface GitHubOAuthClientCredentials {
  clientId: string;
  clientSecret: string;
}

/**
 * DB-first, env-fallback GitHub OAuth client credentials for the sign-in
 * provider (ADR-019, PN-5 "wire sign-in to stored creds"). The wizard's
 * exchange/credentials endpoints persist `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET`
 * against a GitHub App connection. Sign-in is enabled only when the choice is
 * unambiguous: environment credentials win when explicitly configured;
 * otherwise exactly one active connection may supply a complete client pair.
 */
export async function resolveGitHubOAuthClient(
  env: Env,
  db: D1Database,
): Promise<GitHubOAuthClientCredentials | null> {
  const environment = envProvider(env);
  const environmentClientId = await environment.get('GITHUB_CLIENT_ID');
  const environmentClientSecret = await environment.get('GITHUB_CLIENT_SECRET');
  if (environmentClientId && environmentClientSecret) {
    return { clientId: environmentClientId, clientSecret: environmentClientSecret };
  }

  const candidates: GitHubOAuthClientCredentials[] = [];
  for (const connection of await listActiveConnectionsByType(db, 'github')) {
    const provider = await connectionSecretProvider(env, db, connection.id);
    const clientId = await provider.get('GITHUB_CLIENT_ID');
    const clientSecret = await provider.get('GITHUB_CLIENT_SECRET');
    if (clientId && clientSecret) candidates.push({ clientId, clientSecret });
  }
  return candidates.length === 1 ? candidates[0] ?? null : null;
}

export interface GitLabCredentials {
  token: string;
  baseUrl: string;
}

/** Resolve one explicitly scoped GitLab connection, or the environment set before a row exists. */
export async function resolveGitLabCredentials(
  env: Env,
  db: D1Database,
  connectionId?: string,
): Promise<GitLabCredentials | null> {
  const activeConnections = connectionId ? [] : await listActiveConnectionsByType(db, 'gitlab');
  if (!connectionId && activeConnections.length > 1) return null;
  const connection = connectionId
    ? await getConnectionById(db, connectionId)
    : activeConnections[0] ?? null;
  if (connection && connection.provider_type !== 'gitlab') return null;
  const provider = await connectionSecretProvider(env, db, connection?.id ?? null);
  const token = await provider.get('GITLAB_TOKEN');
  if (!token) return null;
  return { token, baseUrl: connection?.base_url ?? env.GITLAB_BASE_URL ?? 'https://gitlab.com' };
}

export async function resolveGitLabWebhookSecret(
  env: Env,
  db: D1Database,
  connectionId?: string,
): Promise<string | null> {
  const activeConnections = connectionId ? [] : await listActiveConnectionsByType(db, 'gitlab');
  if (!connectionId && activeConnections.length > 1) return null;
  const connection = connectionId
    ? await getConnectionById(db, connectionId)
    : activeConnections[0] ?? null;
  if (connection && connection.provider_type !== 'gitlab') return null;
  const provider = await connectionSecretProvider(env, db, connection?.id ?? null);
  return await provider.get('GITLAB_WEBHOOK_SECRET') ?? null;
}
