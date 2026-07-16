/**
 * Storage selection for the Node host.
 *
 * The host runs on either an embedded SQLite file (the zero-dependency default,
 * ideal for a single container with a persistent volume) or a shared PostgreSQL
 * database (for multi-replica deployments behind a load balancer). Both present
 * the identical D1-compatible surface to the shared app, so nothing above the
 * storage seam changes — this is the PN-1 storage abstraction realised at the
 * host boundary.
 *
 * Selection is by configuration: set `DATABASE_URL` (a PostgreSQL connection
 * string) to use PostgreSQL; otherwise SQLite is used. This keeps the common
 * case ("just run it") free of any database to provision.
 */
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { openPostgresD1, applyPostgresMigrations } from '@repo-wrangler/persistence-postgres';
import type { ServerConfig } from './env';

/** A resolved storage backend, abstracting SQLite vs PostgreSQL. */
export interface Store {
  /** D1-compatible handle to inject as the `DB` binding. */
  d1: D1Database;
  /** Apply pending migrations; returns the filenames applied (empty if none). */
  applyMigrations(): Promise<string[]>;
  /** Release the backend (close the file handle / drain the pool). */
  close(): Promise<void>;
  /** Human-readable backend description for logs (never contains a password). */
  label: string;
}

/** Strip credentials from a connection string for safe logging. */
function redact(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    const db = url.pathname.replace(/^\//, '') || '(default)';
    return `postgres://${url.host}/${db}`;
  } catch {
    return 'postgres';
  }
}

/** Describe only the selected backend, without initializing either adapter. */
export function storageLabel(config: Pick<ServerConfig, 'databaseUrl' | 'sqlitePath'>): string {
  return config.databaseUrl ? redact(config.databaseUrl) : `sqlite (${config.sqlitePath})`;
}

/** Open the storage backend selected by configuration. */
export async function openStore(config: ServerConfig): Promise<Store> {
  if (config.databaseUrl) {
    const { d1, pool } = openPostgresD1(config.databaseUrl);
    return {
      d1: d1 as unknown as D1Database,
      applyMigrations: () => applyPostgresMigrations(pool, config.migrationsDir),
      close: () => pool.end(),
      label: storageLabel(config),
    };
  }

  await mkdir(dirname(config.sqlitePath), { recursive: true });
  // Keep node:sqlite completely out of PostgreSQL processes. Importing the
  // adapter eagerly makes Node emit its experimental SQLite warning at boot,
  // even though DATABASE_URL selected PostgreSQL and no SQLite file is opened.
  const { openSqliteD1, applyMigrations: applySqliteMigrations } =
    await import('@repo-wrangler/persistence-sqlite');
  const { d1, raw } = openSqliteD1(config.sqlitePath);
  return {
    d1: d1 as unknown as D1Database,
    applyMigrations: async () => applySqliteMigrations(raw, config.migrationsDir),
    close: async () => {
      try {
        raw.close();
      } catch {
        /* already closed */
      }
    },
    label: storageLabel(config),
  };
}
