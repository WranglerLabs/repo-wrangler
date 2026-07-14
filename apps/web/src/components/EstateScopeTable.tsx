import { Fragment, useMemo, useState } from 'react';
import type { MonitoringState } from '../api/client';

/**
 * Onboarding design B2/B5 — the shared "choose what to monitor" table. The
 * wizard's Step 3 and the permanent Administration → Estate scope screen
 * render the exact same component (design: "not a separate code path from
 * the wizard"), just with different data: the wizard has workspace-level
 * `repoCount` previews only (repositories haven't been discovered yet), the
 * management screen has real per-repository rows to nest under each
 * workspace once discovery has run.
 */

export interface ScopeWorkspace {
  id: string;
  slug: string;
  displayName?: string;
  kind: string;
  monitoringState: MonitoringState;
  repoCount?: number;
}

export interface ScopeRepository {
  id: string;
  fullName: string;
  monitoringState: MonitoringState;
}

interface EstateScopeTableProps {
  workspaces: ScopeWorkspace[];
  /** Present once discovery has populated repositories (B5); absent in the wizard. */
  repositoriesByWorkspace?: Record<string, ScopeRepository[]>;
  onToggleWorkspace: (id: string, next: MonitoringState) => void;
  onToggleRepo?: (id: string, next: MonitoringState) => void;
  /** ids currently mid-request, disabled while in flight. */
  pending?: ReadonlySet<string>;
}

export function EstateScopeTable({
  workspaces,
  repositoriesByWorkspace,
  onToggleWorkspace,
  onToggleRepo,
  pending,
}: EstateScopeTableProps) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return workspaces;
    return workspaces.filter((w) => {
      if ((w.displayName ?? w.slug).toLowerCase().includes(term) || w.slug.toLowerCase().includes(term)) {
        return true;
      }
      const repos = repositoriesByWorkspace?.[w.id] ?? [];
      return repos.some((r) => r.fullName.toLowerCase().includes(term));
    });
  }, [workspaces, repositoriesByWorkspace, search]);

  function selectAllOrNone(next: MonitoringState) {
    for (const w of filtered) {
      if (w.monitoringState !== next) onToggleWorkspace(w.id, next);
      if (onToggleRepo) {
        for (const r of repositoriesByWorkspace?.[w.id] ?? []) {
          if (r.monitoringState !== next) onToggleRepo(r.id, next);
        }
      }
    }
  }

  return (
    <div>
      <div className="toolbar">
        <input
          type="search"
          placeholder="Search organizations, groups, repositories…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button className="ghost" onClick={() => selectAllOrNone('monitored')}>
            Select all
          </button>
          <button className="ghost" onClick={() => selectAllOrNone('ignored')}>
            Select none
          </button>
        </span>
      </div>

      <div className="panel table-scroll">
        <table className="data">
          <thead>
            <tr>
              <th>Workspace / repository</th>
              <th>Kind</th>
              <th>Repositories</th>
              <th>Monitor</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  Nothing matches “{search}”.
                </td>
              </tr>
            )}
            {filtered.map((w) => {
              const repos = repositoriesByWorkspace?.[w.id] ?? [];
              const isBusy = pending?.has(w.id) ?? false;
              return (
                <Fragment key={w.id}>
                  <tr>
                    <td>
                      <strong>▸ {w.displayName ?? w.slug}</strong>
                      <div className="muted">{w.slug}</div>
                    </td>
                    <td>{w.kind}</td>
                    <td>{w.repoCount ?? repos.length}</td>
                    <td>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input
                          type="checkbox"
                          checked={w.monitoringState === 'monitored'}
                          disabled={isBusy}
                          onChange={(e) =>
                            onToggleWorkspace(w.id, e.target.checked ? 'monitored' : 'ignored')
                          }
                        />
                        {w.monitoringState === 'monitored' ? 'monitor' : 'ignore'}
                      </label>
                    </td>
                  </tr>
                  {onToggleRepo &&
                    repos.map((r) => {
                      const repoBusy = pending?.has(r.id) ?? false;
                      return (
                        <tr key={r.id} className="muted">
                          <td style={{ paddingLeft: '2rem' }}>├ {r.fullName}</td>
                          <td />
                          <td />
                          <td>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <input
                                type="checkbox"
                                checked={r.monitoringState === 'monitored'}
                                disabled={repoBusy || w.monitoringState === 'ignored'}
                                onChange={(e) =>
                                  onToggleRepo(r.id, e.target.checked ? 'monitored' : 'ignored')
                                }
                              />
                              {r.monitoringState === 'monitored' ? 'monitor' : 'ignore'}
                            </label>
                          </td>
                        </tr>
                      );
                    })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
