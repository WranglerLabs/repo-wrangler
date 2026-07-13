import { describe, expect, it } from 'vitest';
import { translateSql } from '../src/translate';

describe('translateSql — placeholders', () => {
  it('rewrites ?N to $N', () => {
    expect(translateSql('SELECT * FROM repositories WHERE full_name = ?1 LIMIT 1')).toBe(
      'SELECT * FROM repositories WHERE full_name = $1 LIMIT 1',
    );
  });

  it('rewrites every placeholder in a multi-column insert', () => {
    const out = translateSql('VALUES (?1, ?2, ?3, ?4, ?5)');
    expect(out).toBe('VALUES ($1, $2, $3, $4, $5)');
  });

  it('keeps a reused placeholder number stable (?1 → $1 both times)', () => {
    const out = translateSql('UPDATE t SET a = ?2 WHERE id = ?1 AND prev = ?1');
    expect(out).toBe('UPDATE t SET a = $2 WHERE id = $1 AND prev = $1');
  });

  it('rewrites double-digit placeholders', () => {
    expect(translateSql('VALUES (?9, ?10, ?11, ?20)')).toBe('VALUES ($9, $10, $11, $20)');
  });
});

describe('translateSql — case-preserving aliases', () => {
  it('quotes a camelCase alias so PostgreSQL keeps its casing', () => {
    expect(translateSql('(SELECT COUNT(*) FROM change_requests) AS openCrs')).toBe(
      '(SELECT COUNT(*) FROM change_requests) AS "openCrs"',
    );
  });

  it('quotes every camelCase alias in the estate-counts query', () => {
    const sql = `SELECT
      (SELECT COUNT(*) FROM change_requests WHERE state = 'open') AS openCrs,
      (SELECT COUNT(*) FROM branches WHERE comparison_status IN ('ahead', 'diverged')) AS branchesAhead,
      (SELECT COUNT(*) FROM security_findings WHERE state = 'open') AS securityOpen`;
    expect(sql).not.toContain('"openCrs"');
    const out = translateSql(sql);
    expect(out).toContain('AS "openCrs"');
    expect(out).toContain('AS "branchesAhead"');
    expect(out).toContain('AS "securityOpen"');
  });

  it('quotes a camelCase alias that also contains digits', () => {
    expect(translateSql('SELECT 1 AS lastPush7d')).toBe('SELECT 1 AS "lastPush7d"');
  });

  it('leaves all-lowercase aliases unquoted — they round-trip unchanged', () => {
    // PostgreSQL folds unquoted identifiers to lower case, so an already
    // lower-case alias (even with digits) comes back exactly as written.
    expect(translateSql('SELECT x AS latest_run_conclusion')).toBe(
      'SELECT x AS latest_run_conclusion',
    );
    expect(translateSql('SELECT 1 AS received24h, 2 AS new7d')).toBe(
      'SELECT 1 AS received24h, 2 AS new7d',
    );
  });

  it('does not quote a lowercase type name in a CAST expression', () => {
    // Defensive: no CAST exists in the current query set, but the rule must not
    // corrupt one if added later, because the type name is lower case.
    expect(translateSql('SELECT CAST(x AS integer)')).toBe('SELECT CAST(x AS integer)');
  });
});

describe('translateSql — INSERT OR IGNORE', () => {
  it('becomes INSERT … ON CONFLICT DO NOTHING', () => {
    const out = translateSql(
      `INSERT OR IGNORE INTO webhook_deliveries (delivery_id, provider) VALUES (?1, ?2)`,
    );
    expect(out).toBe(
      'INSERT INTO webhook_deliveries (delivery_id, provider) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    );
  });
});

describe('translateSql — left unchanged', () => {
  it('leaves datetime() calls for the compatibility functions to handle', () => {
    const sql = `UPDATE t SET updated_at = datetime('now') WHERE created_at < datetime('now', ?1)`;
    expect(translateSql(sql)).toBe(
      `UPDATE t SET updated_at = datetime('now') WHERE created_at < datetime('now', $1)`,
    );
  });

  it('leaves a concatenated datetime modifier intact', () => {
    const sql = `SET next_eligible_at = datetime('now', '+' || (attempts * 15) || ' minutes')`;
    expect(translateSql(sql)).toBe(sql);
  });

  it('leaves ON CONFLICT … DO UPDATE SET … = excluded.col intact', () => {
    const sql = `INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value`;
    expect(translateSql(sql)).toBe(
      'INSERT INTO meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    );
  });
});
