import { describe, expect, it } from 'vitest';
import { storageLabel } from '../src/store';

describe('storageLabel', () => {
  it('describes PostgreSQL without exposing credentials or mentioning SQLite', () => {
    const label = storageLabel({
      databaseUrl: 'postgresql://repo-user:super-secret@postgres.example:5432/repowrangler?sslmode=require',
      sqlitePath: '/app/data/repo-wrangler.db',
    });
    expect(label).toBe('postgres://postgres.example:5432/repowrangler');
    expect(label).not.toContain('super-secret');
    expect(label.toLowerCase()).not.toContain('sqlite');
  });

  it('describes the SQLite path only when PostgreSQL is not configured', () => {
    expect(storageLabel({ databaseUrl: undefined, sqlitePath: '/data/repo-wrangler.db' }))
      .toBe('sqlite (/data/repo-wrangler.db)');
  });
});

