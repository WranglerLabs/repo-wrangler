/**
 * AWS Secrets Manager provider (PN-4). SDK-free: a SigV4-signed `GetSecretValue`
 * call using only Web Crypto and `fetch`, so it adds no dependency and runs on
 * any runtime. Credentials come from the standard AWS environment variables
 * (`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / optional `AWS_SESSION_TOKEN`),
 * which is how ECS/EKS/Lambda roles and `~/.aws` both surface them. Env names map
 * to secret ids by lower-kebab convention (with an optional prefix).
 */
import type { SecretProvider } from './provider';
import { keyVaultSecretName } from './provider';

const SERVICE = 'secretsmanager';
const enc = new TextEncoder();

export interface AwsOptions {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  /** Optional secret-id prefix, e.g. `repo-wrangler/`. */
  prefix?: string;
  fetchImpl?: typeof fetch;
  /** Injectable clock for deterministic signing in tests. */
  now?: () => Date;
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(message: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(message)));
}

async function hmac(key: ArrayBuffer | Uint8Array, message: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message));
}

export class AwsSecretsManagerProvider implements SecretProvider {
  readonly label: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;

  constructor(private readonly opts: AwsOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.now = opts.now ?? (() => new Date());
    this.label = `aws-secrets-manager(${opts.region})`;
  }

  async get(name: string): Promise<string | undefined> {
    const secretId = `${this.opts.prefix ?? ''}${keyVaultSecretName(name)}`;
    const host = `${SERVICE}.${this.opts.region}.amazonaws.com`;
    const endpoint = `https://${host}/`;
    const body = JSON.stringify({ SecretId: secretId });
    const target = 'secretsmanager.GetSecretValue';

    const date = this.now();
    const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, ''); // YYYYMMDDTHHMMSSZ
    const dateStamp = amzDate.slice(0, 8);

    const payloadHash = await sha256Hex(body);
    const canonicalHeaders =
      `content-type:application/x-amz-json-1.1\n` +
      `host:${host}\n` +
      `x-amz-date:${amzDate}\n` +
      `x-amz-target:${target}\n` +
      (this.opts.sessionToken ? `x-amz-security-token:${this.opts.sessionToken}\n` : '');
    const signedHeaders =
      'content-type;host;x-amz-date;x-amz-target' +
      (this.opts.sessionToken ? ';x-amz-security-token' : '');
    const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

    const scope = `${dateStamp}/${this.opts.region}/${SERVICE}/aws4_request`;
    const stringToSign =
      `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${await sha256Hex(canonicalRequest)}`;

    const kDate = await hmac(enc.encode(`AWS4${this.opts.secretAccessKey}`), dateStamp);
    const kRegion = await hmac(kDate, this.opts.region);
    const kService = await hmac(kRegion, SERVICE);
    const kSigning = await hmac(kService, 'aws4_request');
    const signature = toHex(await hmac(kSigning, stringToSign));

    const authorization =
      `AWS4-HMAC-SHA256 Credential=${this.opts.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const headers: Record<string, string> = {
      'content-type': 'application/x-amz-json-1.1',
      'x-amz-date': amzDate,
      'x-amz-target': target,
      authorization,
    };
    if (this.opts.sessionToken) headers['x-amz-security-token'] = this.opts.sessionToken;

    const res = await this.fetchImpl(endpoint, { method: 'POST', headers, body });
    if (res.status === 400 || res.status === 404) {
      // ResourceNotFoundException comes back as 400; treat "not found" as absent.
      const text = await res.text();
      if (/ResourceNotFound/i.test(text)) return undefined;
      throw new Error(`AWS Secrets Manager read of ${secretId} failed (${res.status})`);
    }
    if (!res.ok) throw new Error(`AWS Secrets Manager read of ${secretId} failed (${res.status})`);
    const data = (await res.json()) as { SecretString?: string };
    return data.SecretString;
  }
}
