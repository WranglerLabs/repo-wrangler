/**
 * CyberArk secret provider (PN-4) — enterprise PAM. SDK-free.
 *
 * Uses the Central Credential Provider (CCP) / AIM web service, which returns a
 * credential over REST with application-based authentication (an `AppID` allowed
 * from this machine) — no token round-trip:
 *
 *   GET https://{host}/AIMWebService/api/Accounts?AppID=&Safe=&Object={object}
 *   → { "Content": "the-secret", ... }
 *
 * Env names map to the CCP `Object` name by lower-kebab convention (with an
 * optional prefix). A client certificate, if required by the CCP, is configured
 * at the platform/proxy layer — this adapter only issues the HTTPS GET.
 */
import type { SecretProvider } from './provider';
import { keyVaultSecretName } from './provider';

export interface CyberArkOptions {
  /** CCP base URL, e.g. https://cyberark.example.com */
  baseUrl: string;
  appId: string;
  safe: string;
  /** Optional object-name prefix, e.g. `repo-wrangler-`. */
  objectPrefix?: string;
  fetchImpl?: typeof fetch;
}

export class CyberArkSecretProvider implements SecretProvider {
  readonly label: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: CyberArkOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.label = `cyberark(${new URL(opts.baseUrl).host}/${opts.safe})`;
  }

  async get(name: string): Promise<string | undefined> {
    const object = `${this.opts.objectPrefix ?? ''}${keyVaultSecretName(name)}`;
    const base = this.opts.baseUrl.replace(/\/$/, '');
    const url = new URL(`${base}/AIMWebService/api/Accounts`);
    url.searchParams.set('AppID', this.opts.appId);
    url.searchParams.set('Safe', this.opts.safe);
    url.searchParams.set('Object', object);

    const res = await this.fetchImpl(url.toString(), { headers: { accept: 'application/json' } });
    // CCP returns 404 with APPAP004E when the object is not found.
    if (res.status === 404) return undefined;
    if (!res.ok) throw new Error(`CyberArk CCP read of ${object} failed (${res.status})`);
    const body = (await res.json()) as { Content?: string };
    return body.Content;
  }
}
