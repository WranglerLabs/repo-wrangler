import { CompositeSecretProvider, EnvSecretProvider, type SecretProvider } from '@repo-wrangler/secrets-core/provider';
import { DbSecretProvider, deriveEncryptionKey } from '@repo-wrangler/secrets-core/db';
import { D1ConnectionSecretStore } from '@repo-wrangler/persistence-d1';
import type { Env } from '../bindings';

const ENTRA_IDENTITY_REFERENCE = 'identity:entra';
const GITHUB_IDENTITY_REFERENCE = 'identity:github';

export interface EntraIdentityCredentials {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  allowedUsers?: string;
}

async function provider(env: Env, reference: string): Promise<SecretProvider> {
  const fallback = new EnvSecretProvider(env as unknown as Record<string, string | undefined>);
  if (!env.SECRET_ENCRYPTION_KEY) return fallback;
  const key = await deriveEncryptionKey(env.SECRET_ENCRYPTION_KEY);
  const stored = new DbSecretProvider(
    new D1ConnectionSecretStore(env.DB),
    reference,
    key,
  );
  return new CompositeSecretProvider([stored, fallback]);
}

export async function resolveEntraIdentity(env: Env): Promise<EntraIdentityCredentials | null> {
  const secrets = await provider(env, ENTRA_IDENTITY_REFERENCE);
  const tenantId = await secrets.get('ENTRA_TENANT_ID');
  const clientId = await secrets.get('ENTRA_CLIENT_ID');
  const clientSecret = await secrets.get('ENTRA_CLIENT_SECRET');
  if (!tenantId || !clientId || !clientSecret) return null;
  return { tenantId, clientId, clientSecret, allowedUsers: await secrets.get('ENTRA_ALLOWED_USERS') };
}

export async function resolveGitHubAllowedUsers(env: Env): Promise<string | undefined> {
  const secrets = await provider(env, GITHUB_IDENTITY_REFERENCE);
  return secrets.get('ALLOWED_GITHUB_USERS');
}

export async function storeGitHubIdentity(env: Env, allowedUsers: string): Promise<void> {
  if (!env.SECRET_ENCRYPTION_KEY) throw new Error('SECRET_ENCRYPTION_KEY is not configured.');
  const key = await deriveEncryptionKey(env.SECRET_ENCRYPTION_KEY);
  const secrets = new DbSecretProvider(
    new D1ConnectionSecretStore(env.DB),
    GITHUB_IDENTITY_REFERENCE,
    key,
  );
  await secrets.set('ALLOWED_GITHUB_USERS', allowedUsers);
}

export async function storeEntraIdentity(
  env: Env,
  credentials: EntraIdentityCredentials,
): Promise<void> {
  if (!env.SECRET_ENCRYPTION_KEY) throw new Error('SECRET_ENCRYPTION_KEY is not configured.');
  const key = await deriveEncryptionKey(env.SECRET_ENCRYPTION_KEY);
  const secrets = new DbSecretProvider(
    new D1ConnectionSecretStore(env.DB),
    ENTRA_IDENTITY_REFERENCE,
    key,
  );
  await Promise.all([
    secrets.set('ENTRA_TENANT_ID', credentials.tenantId),
    secrets.set('ENTRA_CLIENT_ID', credentials.clientId),
    secrets.set('ENTRA_CLIENT_SECRET', credentials.clientSecret),
    credentials.allowedUsers
      ? secrets.set('ENTRA_ALLOWED_USERS', credentials.allowedUsers)
      : secrets.delete('ENTRA_ALLOWED_USERS'),
  ]);
}
