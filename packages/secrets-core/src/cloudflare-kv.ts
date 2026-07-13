/**
 * Cloudflare Workers KV secret provider (PN-4). SDK-free REST read of a KV
 * namespace using a Cloudflare API token.
 *
 * NOTE: Cloudflare's recommended mechanism for *sensitive* values is Cloudflare
 * Secrets / Secrets Store (encrypted, access-controlled) — already covered by the
 * `env` adapter on the Worker. Workers KV is eventually-consistent general-purpose
 * storage; this adapter is offered as an option (no lock-in), not the
 * best-practice secret store. Env names map to keys by lower-kebab convention.
 */
import type { SecretProvider } from './provider';
import { keyVaultSecretName } from './provider';

export interface CloudflareKvOptions {
  accountId: string;
  namespaceId: string;
  apiToken: string;
  /** Optional key prefix, e.g. `repo-wrangler/`. */
  prefix?: string;
  fetchImpl?: typeof fetch;
}

export class CloudflareKvSecretProvider implements SecretProvider {
  readonly label: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: CloudflareKvOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.label = `cloudflare-kv(${opts.namespaceId})`;
  }

  async get(name: string): Promise<string | undefined> {
    const key = `${this.opts.prefix ?? ''}${keyVaultSecretName(name)}`;
    const url =
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(this.opts.accountId)}` +
      `/storage/kv/namespaces/${encodeURIComponent(this.opts.namespaceId)}` +
      `/values/${encodeURIComponent(key)}`;
    const res = await this.fetchImpl(url, {
      headers: { authorization: `Bearer ${this.opts.apiToken}` },
    });
    if (res.status === 404) return undefined;
    if (!res.ok) throw new Error(`Cloudflare KV read of ${key} failed (${res.status})`);
    // The values endpoint returns the raw stored value (not JSON-wrapped).
    return res.text();
  }
}
