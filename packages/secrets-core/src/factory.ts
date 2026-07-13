/**
 * Build the configured secret provider for a Node host (PN-4).
 *
 * `SECRET_SOURCE` selects the strategy; env is always the fall-through so local
 * overrides and non-secret config keep working:
 *
 *   - `env`       (default) — environment variables only.
 *   - `file`      — Docker/Kubernetes mounted secrets (`SECRETS_DIR`, default
 *                   `/run/secrets`), then env.
 *   - `keyvault`  — Azure Key Vault (`KEY_VAULT_URI`) via managed identity, then env.
 *   - `composite` — file, then Key Vault (if `KEY_VAULT_URI` set), then env.
 *
 * The returned provider is what the host passes to `resolveSecrets` at boot.
 */
import {
  CompositeSecretProvider,
  EnvSecretProvider,
  type SecretProvider,
} from './provider';
import { DEFAULT_SECRETS_DIR, FileSecretProvider } from './file';
import { KeyVaultSecretProvider } from './keyvault';

export function createSecretProvider(
  env: Record<string, string | undefined> = process.env,
): SecretProvider {
  const source = (env.SECRET_SOURCE ?? 'env').toLowerCase();
  const envProvider = new EnvSecretProvider(env);
  const dir = env.SECRETS_DIR || DEFAULT_SECRETS_DIR;
  const vaultUri = env.KEY_VAULT_URI;

  switch (source) {
    case 'file':
      return new CompositeSecretProvider([new FileSecretProvider(dir), envProvider]);
    case 'keyvault': {
      if (!vaultUri) {
        throw new Error('SECRET_SOURCE=keyvault requires KEY_VAULT_URI');
      }
      return new CompositeSecretProvider([new KeyVaultSecretProvider(vaultUri), envProvider]);
    }
    case 'composite': {
      const providers: SecretProvider[] = [new FileSecretProvider(dir)];
      if (vaultUri) providers.push(new KeyVaultSecretProvider(vaultUri));
      providers.push(envProvider);
      return new CompositeSecretProvider(providers);
    }
    case 'env':
      return envProvider;
    default:
      throw new Error(`Unknown SECRET_SOURCE '${source}' (env|file|keyvault|composite)`);
  }
}
