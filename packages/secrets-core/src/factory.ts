/**
 * Build the configured secret provider for a Node host (PN-4).
 *
 * `SECRET_SOURCE` selects the strategy; env is always the fall-through so local
 * overrides and non-secret config keep working. No cloud is privileged — the
 * external-vault options span self-hosted and every major cloud:
 *
 *   - `env`       (default) — environment variables / Cloudflare secrets.
 *   - `file`      — Docker/Kubernetes mounted secrets (`SECRETS_DIR`), then env.
 *                   Also covers any CSI driver (AWS/GCP/Vault) that mounts files.
 *   - `keyvault`  — Azure Key Vault (`KEY_VAULT_URI`, managed identity), then env.
 *   - `vault`     — HashiCorp Vault (`VAULT_ADDR`/`VAULT_TOKEN`), then env.
 *   - `aws`       — AWS Secrets Manager (`AWS_REGION` + AWS creds), then env.
 *   - `gcp`       — GCP Secret Manager (`GCP_PROJECT`, metadata token), then env.
 *   - `composite` — file → (whichever external vaults are configured) → env.
 */
import {
  CompositeSecretProvider,
  EnvSecretProvider,
  type SecretProvider,
} from './provider';
import { DEFAULT_SECRETS_DIR, FileSecretProvider } from './file';
import { KeyVaultSecretProvider } from './keyvault';
import { VaultSecretProvider } from './vault';
import { AwsSecretsManagerProvider } from './aws';
import { GcpSecretManagerProvider } from './gcp';

type Env = Record<string, string | undefined>;

function keyVault(env: Env): SecretProvider | null {
  return env.KEY_VAULT_URI ? new KeyVaultSecretProvider(env.KEY_VAULT_URI) : null;
}

function hashiVault(env: Env): SecretProvider | null {
  if (!env.VAULT_ADDR || !env.VAULT_TOKEN) return null;
  return new VaultSecretProvider({
    address: env.VAULT_ADDR,
    token: env.VAULT_TOKEN,
    mount: env.VAULT_KV_MOUNT,
    prefix: env.VAULT_KV_PREFIX,
    namespace: env.VAULT_NAMESPACE,
  });
}

function awsSecrets(env: Env): SecretProvider | null {
  if (!env.AWS_REGION || !env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) return null;
  return new AwsSecretsManagerProvider({
    region: env.AWS_REGION,
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    sessionToken: env.AWS_SESSION_TOKEN,
    prefix: env.AWS_SECRET_PREFIX,
  });
}

function gcpSecrets(env: Env): SecretProvider | null {
  const project = env.GCP_PROJECT || env.GOOGLE_CLOUD_PROJECT;
  return project ? new GcpSecretManagerProvider(project) : null;
}

function require1(provider: SecretProvider | null, source: string, need: string): SecretProvider {
  if (!provider) throw new Error(`SECRET_SOURCE=${source} requires ${need}`);
  return provider;
}

export function createSecretProvider(env: Env = process.env): SecretProvider {
  const source = (env.SECRET_SOURCE ?? 'env').toLowerCase();
  const envProvider = new EnvSecretProvider(env);
  const dir = env.SECRETS_DIR || DEFAULT_SECRETS_DIR;

  switch (source) {
    case 'env':
      return envProvider;
    case 'file':
      return new CompositeSecretProvider([new FileSecretProvider(dir), envProvider]);
    case 'keyvault':
      return new CompositeSecretProvider([require1(keyVault(env), source, 'KEY_VAULT_URI'), envProvider]);
    case 'vault':
      return new CompositeSecretProvider([
        require1(hashiVault(env), source, 'VAULT_ADDR and VAULT_TOKEN'),
        envProvider,
      ]);
    case 'aws':
      return new CompositeSecretProvider([
        require1(awsSecrets(env), source, 'AWS_REGION and AWS credentials'),
        envProvider,
      ]);
    case 'gcp':
      return new CompositeSecretProvider([
        require1(gcpSecrets(env), source, 'GCP_PROJECT'),
        envProvider,
      ]);
    case 'composite': {
      const providers: SecretProvider[] = [new FileSecretProvider(dir)];
      for (const p of [keyVault(env), hashiVault(env), awsSecrets(env), gcpSecrets(env)]) {
        if (p) providers.push(p);
      }
      providers.push(envProvider);
      return new CompositeSecretProvider(providers);
    }
    default:
      throw new Error(
        `Unknown SECRET_SOURCE '${source}' (env|file|keyvault|vault|aws|gcp|composite)`,
      );
  }
}
