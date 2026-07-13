/**
 * Google Cloud Secret Manager provider (PN-4). SDK-free: an OAuth token from the
 * GCP metadata server (the workload's service account) plus a REST read of the
 * latest secret version. Mirrors the Azure adapter's managed-identity approach so
 * no cloud is privileged. Env names map to secret ids by lower-kebab convention.
 */
import type { SecretProvider } from './provider';
import { keyVaultSecretName } from './provider';

const METADATA_TOKEN_URL =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';

export interface GcpDeps {
  fetch: typeof fetch;
  now: () => number;
}

export class GcpSecretManagerProvider implements SecretProvider {
  readonly label: string;
  private cached: { token: string; expiresAt: number } | null = null;

  constructor(
    private readonly project: string,
    private readonly deps: GcpDeps = { fetch, now: () => Date.now() / 1000 },
  ) {
    this.label = `gcp-secret-manager(${project})`;
  }

  private async token(): Promise<string> {
    if (this.cached && this.cached.expiresAt > this.deps.now() + 60) return this.cached.token;
    const res = await this.deps.fetch(METADATA_TOKEN_URL, {
      headers: { 'Metadata-Flavor': 'Google' },
    });
    if (!res.ok) throw new Error(`GCP metadata token request failed (${res.status})`);
    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) throw new Error('GCP metadata token response had no access_token');
    this.cached = { token: data.access_token, expiresAt: this.deps.now() + (data.expires_in ?? 3600) };
    return data.access_token;
  }

  async get(name: string): Promise<string | undefined> {
    const token = await this.token();
    const id = keyVaultSecretName(name);
    const url = `https://secretmanager.googleapis.com/v1/projects/${encodeURIComponent(
      this.project,
    )}/secrets/${encodeURIComponent(id)}/versions/latest:access`;
    const res = await this.deps.fetch(url, { headers: { authorization: `Bearer ${token}` } });
    if (res.status === 404) return undefined;
    if (!res.ok) throw new Error(`GCP Secret Manager read of ${id} failed (${res.status})`);
    const body = (await res.json()) as { payload?: { data?: string } };
    const b64 = body.payload?.data;
    if (typeof b64 !== 'string') return undefined;
    // Payload is base64-encoded (URL-safe or standard).
    return atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  }
}
