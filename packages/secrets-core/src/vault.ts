/**
 * HashiCorp Vault secret provider (PN-4) — the cloud-neutral vault.
 *
 * Vault runs anywhere (self-hosted, HCP, any cloud), so it is the portable
 * counterpart to a cloud-specific vault. SDK-free: a single REST read of the KV
 * v2 engine with a Vault token (`VAULT_TOKEN`, or any token source injected by
 * the host). Env names map to KV keys by lower-kebab convention.
 *
 *   secret at {VAULT_ADDR}/v1/{mount}/data/{prefix}{name}  →  data.data.value
 */
import type { SecretProvider } from './provider';
import { keyVaultSecretName } from './provider';

export interface VaultOptions {
  /** Base address, e.g. `https://vault.example.com:8200` (no trailing slash needed). */
  address: string;
  /** Vault token used as `X-Vault-Token`. */
  token: string;
  /** KV v2 mount path (default `secret`). */
  mount?: string;
  /** Optional path prefix under the mount, e.g. `repo-wrangler/`. */
  prefix?: string;
  /** Optional namespace (Vault Enterprise / HCP) → `X-Vault-Namespace`. */
  namespace?: string;
  fetchImpl?: typeof fetch;
}

export class VaultSecretProvider implements SecretProvider {
  readonly label: string;
  private readonly mount: string;
  private readonly prefix: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: VaultOptions) {
    this.mount = (opts.mount ?? 'secret').replace(/^\/|\/$/g, '');
    this.prefix = opts.prefix ?? '';
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.label = `vault(${new URL(opts.address).host}/${this.mount})`;
  }

  async get(name: string): Promise<string | undefined> {
    const base = this.opts.address.replace(/\/$/, '');
    const key = `${this.prefix}${keyVaultSecretName(name)}`;
    const url = `${base}/v1/${this.mount}/data/${key}`;
    const headers: Record<string, string> = { 'X-Vault-Token': this.opts.token };
    if (this.opts.namespace) headers['X-Vault-Namespace'] = this.opts.namespace;

    const res = await this.fetchImpl(url, { headers });
    if (res.status === 404) return undefined;
    if (!res.ok) throw new Error(`Vault read of ${key} failed (${res.status})`);
    // KV v2 shape: { data: { data: { value: "..." }, metadata: {...} } }.
    const body = (await res.json()) as { data?: { data?: Record<string, unknown> } };
    const secret = body.data?.data;
    if (!secret) return undefined;
    // Prefer a `value` key; otherwise the sole value in the object.
    if (typeof secret.value === 'string') return secret.value;
    const values = Object.values(secret).filter((v): v is string => typeof v === 'string');
    return values.length === 1 ? values[0] : undefined;
  }
}
