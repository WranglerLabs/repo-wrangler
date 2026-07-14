/**
 * The database-backed writable secret provider (ADR-021, onboarding design
 * "Credential entry"). This is the default home for provider credentials
 * entered through the wizard: "enter it in the wizard, no vault, no restart"
 * is true on every deployment target because the database is the one
 * writable store the app always has, unlike env vars (immutable at runtime),
 * Cloudflare secret bindings (writable only via an out-of-band API token),
 * or read-only mounted files.
 *
 * This module stays storage-neutral — it depends only on a small
 * {@link ConnectionSecretStore} port, not on D1 or any concrete database.
 * `@repo-wrangler/persistence-d1` supplies the concrete row store (and, via
 * its existing SQLite/Postgres adapters, runs unchanged on every host).
 * Values are encrypted at rest with AES-GCM via Web Crypto; the encryption
 * key is an *infrastructure* secret (`SECRET_ENCRYPTION_KEY`) resolved at
 * boot through the existing seam and never itself stored in the database.
 */
import type { WritableSecretProvider } from './provider';

// This package targets `lib: ["ES2022"]` (no DOM), so the global `CryptoKey`
// type name isn't declared even though the `crypto.subtle` Web Crypto object
// itself is (via @types/node). Derive the type structurally instead of
// naming it, so this compiles the same on every host (Workers, Node) without
// pulling in `lib.dom`.
type SubtleCryptoKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>;

/** One encrypted row: ciphertext + IV, both base64. */
export interface StoredSecret {
  ciphertext: string;
  iv: string;
}

/**
 * The row-level port `DbSecretProvider` writes through. A backend (D1,
 * Postgres, SQLite) implements this against its `connection_secrets` table;
 * `DbSecretProvider` never sees SQL.
 */
export interface ConnectionSecretStore {
  get(reference: string, name: string): Promise<StoredSecret | undefined>;
  set(
    reference: string,
    name: string,
    value: StoredSecret & { fingerprint: string },
  ): Promise<void>;
  delete(reference: string, name: string): Promise<void>;
}

function base64Encode(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function base64Decode(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Derive a 256-bit AES-GCM key from the `SECRET_ENCRYPTION_KEY` infrastructure
 * secret. The input is expected to already be a high-entropy value (like
 * `SESSION_SECRET`), so a plain SHA-256 digest — not a slow password KDF — is
 * the right primitive: it is deterministic (the same key material always
 * derives the same `CryptoKey`, so decrypting a value written yesterday works
 * today) and does not need a stored salt.
 */
export async function deriveEncryptionKey(secretValue: string): Promise<SubtleCryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secretValue));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** Non-reversible short hint for the masked UI ("••••1a2b"), never the value. */
export async function fingerprintSecret(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return hex.slice(-4);
}

async function encrypt(key: SubtleCryptoKey, plaintext: string): Promise<StoredSecret> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return { ciphertext: base64Encode(new Uint8Array(ciphertext)), iv: base64Encode(iv) };
}

async function decrypt(key: SubtleCryptoKey, stored: StoredSecret): Promise<string | undefined> {
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64Decode(stored.iv) },
      key,
      base64Decode(stored.ciphertext),
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    // Wrong key (rotated `SECRET_ENCRYPTION_KEY`) or corrupt row — treat as
    // absent rather than throwing, consistent with every other provider.
    return undefined;
  }
}

/**
 * A {@link WritableSecretProvider} namespaced to one connection's
 * `secret_reference`. Construct one per connection at the point of use — it
 * is cheap and holds no state beyond the store handle, the namespace, and
 * the derived key.
 */
export class DbSecretProvider implements WritableSecretProvider {
  readonly label = 'db';
  constructor(
    private readonly store: ConnectionSecretStore,
    private readonly reference: string,
    private readonly key: SubtleCryptoKey,
  ) {}

  async get(name: string): Promise<string | undefined> {
    const stored = await this.store.get(this.reference, name);
    if (!stored) return undefined;
    return decrypt(this.key, stored);
  }

  async set(name: string, value: string): Promise<void> {
    const stored = await encrypt(this.key, value);
    await this.store.set(this.reference, name, { ...stored, fingerprint: await fingerprintSecret(value) });
  }

  async delete(name: string): Promise<void> {
    await this.store.delete(this.reference, name);
  }
}
