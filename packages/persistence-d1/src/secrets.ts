// The `/db` subpath, not the full barrel — this package targets
// `@cloudflare/workers-types` only and must never pull in secrets-core's
// Node-only adapters (file/keyvault/vault/aws/gcp/…) into its type graph.
import type { ConnectionSecretStore, StoredSecret } from '@repo-wrangler/secrets-core/db';

/**
 * `connection_secrets` row store (migration 0004, onboarding design "Credential
 * entry"). This is the only piece of the writable secret backend that touches
 * SQL — `@repo-wrangler/secrets-core`'s `DbSecretProvider` does the encryption
 * and never sees a row shape. Runs unchanged against D1, the SQLite adapter,
 * and (via `translateSql`) Postgres, like every other query in this package.
 */
export class D1ConnectionSecretStore implements ConnectionSecretStore {
  constructor(private readonly db: D1Database) {}

  async get(reference: string, name: string): Promise<StoredSecret | undefined> {
    const row = await this.db
      .prepare(`SELECT ciphertext, iv FROM connection_secrets WHERE secret_reference = ?1 AND name = ?2`)
      .bind(reference, name)
      .first<StoredSecret>();
    return row ?? undefined;
  }

  async set(
    reference: string,
    name: string,
    value: StoredSecret & { fingerprint: string },
  ): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO connection_secrets (secret_reference, name, ciphertext, iv, fingerprint, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))
         ON CONFLICT (secret_reference, name) DO UPDATE SET
           ciphertext = excluded.ciphertext, iv = excluded.iv,
           fingerprint = excluded.fingerprint, updated_at = excluded.updated_at`,
      )
      .bind(reference, name, value.ciphertext, value.iv, value.fingerprint)
      .run();
  }

  async delete(reference: string, name: string): Promise<void> {
    await this.db
      .prepare(`DELETE FROM connection_secrets WHERE secret_reference = ?1 AND name = ?2`)
      .bind(reference, name)
      .run();
  }
}

export interface ConnectionSecretHint {
  name: string;
  fingerprint: string | null;
  updated_at: string;
}

/** Presence + masked hint only — never the value (B5 Credentials panel, `GET .../credentials`). */
export async function listConnectionSecretHints(
  db: D1Database,
  reference: string,
): Promise<ConnectionSecretHint[]> {
  const result = await db
    .prepare(
      `SELECT name, fingerprint, updated_at FROM connection_secrets
       WHERE secret_reference = ?1 ORDER BY name`,
    )
    .bind(reference)
    .all<ConnectionSecretHint>();
  return result.results;
}

/** Every secret in a connection's namespace — used when a connection is disconnected. */
export async function deleteAllConnectionSecrets(db: D1Database, reference: string): Promise<void> {
  await db.prepare(`DELETE FROM connection_secrets WHERE secret_reference = ?1`).bind(reference).run();
}
