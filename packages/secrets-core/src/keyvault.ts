/**
 * Azure Key Vault secret provider (PN-4), authenticated with a managed identity.
 *
 * Deliberately SDK-free: it uses only `fetch`, so it adds no dependency and runs
 * on any modern runtime. A managed-identity access token is obtained from the
 * platform's local token endpoint, then the secret is read over the Key Vault
 * REST API. Two token sources are supported, preferred in this order:
 *
 *   1. The App Service / Container Apps token endpoint (`IDENTITY_ENDPOINT` +
 *      `IDENTITY_HEADER`) — the correct source on Azure Container Apps.
 *   2. The IMDS endpoint (`http://169.254.169.254/...`) — VMs and AKS.
 *
 * A user-assigned identity is selected with `AZURE_CLIENT_ID`. Tokens are cached
 * until shortly before expiry so boot-time secret hydration makes one token call.
 */
import type { SecretProvider } from './provider';
import { keyVaultSecretName } from './provider';

const AKV_RESOURCE = 'https://vault.azure.net';
const AKV_API_VERSION = '7.4';

/** Injectable so tests can drive the provider without real network access. */
export interface KeyVaultDeps {
  fetch: typeof fetch;
  env: Record<string, string | undefined>;
  /** Seconds since epoch; injectable for deterministic cache tests. */
  now: () => number;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

export class KeyVaultSecretProvider implements SecretProvider {
  readonly label: string;
  private cached: CachedToken | null = null;

  /**
   * @param vaultUri e.g. `https://my-vault.vault.azure.net` (trailing slash optional).
   */
  constructor(
    private readonly vaultUri: string,
    private readonly deps: KeyVaultDeps = { fetch, env: process.env, now: () => Date.now() / 1000 },
  ) {
    this.label = `keyvault(${new URL(vaultUri).host})`;
  }

  private async token(): Promise<string> {
    if (this.cached && this.cached.expiresAt > this.deps.now() + 60) {
      return this.cached.token;
    }
    const { env } = this.deps;
    const clientId = env.AZURE_CLIENT_ID;

    let url: string;
    const headers: Record<string, string> = {};
    if (env.IDENTITY_ENDPOINT && env.IDENTITY_HEADER) {
      // App Service / Container Apps managed-identity token endpoint.
      const u = new URL(env.IDENTITY_ENDPOINT);
      u.searchParams.set('resource', AKV_RESOURCE);
      u.searchParams.set('api-version', '2019-08-01');
      if (clientId) u.searchParams.set('client_id', clientId);
      url = u.toString();
      headers['X-IDENTITY-HEADER'] = env.IDENTITY_HEADER;
    } else {
      // IMDS (VM / AKS).
      const u = new URL('http://169.254.169.254/metadata/identity/oauth2/token');
      u.searchParams.set('resource', AKV_RESOURCE);
      u.searchParams.set('api-version', '2018-02-01');
      if (clientId) u.searchParams.set('client_id', clientId);
      url = u.toString();
      headers.Metadata = 'true';
    }

    const res = await this.deps.fetch(url, { headers });
    if (!res.ok) {
      throw new Error(`managed-identity token request failed (${res.status})`);
    }
    const data = (await res.json()) as { access_token?: string; expires_on?: string };
    if (!data.access_token) {
      throw new Error('managed-identity token response had no access_token');
    }
    const expiresAt = data.expires_on ? Number(data.expires_on) : this.deps.now() + 600;
    this.cached = { token: data.access_token, expiresAt };
    return data.access_token;
  }

  async get(name: string): Promise<string | undefined> {
    const token = await this.token();
    const base = this.vaultUri.replace(/\/$/, '');
    const secretName = keyVaultSecretName(name);
    const url = `${base}/secrets/${encodeURIComponent(secretName)}?api-version=${AKV_API_VERSION}`;
    const res = await this.deps.fetch(url, { headers: { authorization: `Bearer ${token}` } });
    if (res.status === 404) return undefined;
    if (!res.ok) {
      throw new Error(`Key Vault read of ${secretName} failed (${res.status})`);
    }
    const data = (await res.json()) as { value?: string };
    return data.value;
  }
}
