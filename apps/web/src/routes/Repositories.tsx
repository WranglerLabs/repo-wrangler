import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  createSavedView,
  deleteSavedView,
  useRepositories,
  useSavedViews,
} from '../api/client';
import { AttentionBadge, BranchStatusBadge, RunBadge } from '../components/Badges';
import { timeAgo } from '../lib/format';
import { exportCsv, exportJson, exportMarkdown } from '../lib/export';
import { useVirtualWindow } from '../lib/useVirtualWindow';

const ROW_HEIGHT = 48;
const VIEWPORT_HEIGHT = 600;
const VIRTUALIZE_ABOVE = 50;

interface ViewDefinition {
  search: string;
  level: (typeof LEVELS)[number];
  includeArchived: boolean;
}

const LEVELS = ['all', 'critical', 'high', 'medium', 'low', 'healthy', 'unknown'] as const;

export function Repositories() {
  const [includeArchived, setIncludeArchived] = useState(false);
  const [search, setSearch] = useState('');
  const [level, setLevel] = useState<(typeof LEVELS)[number]>('all');
  const repositories = useRepositories(includeArchived);

  const queryClient = useQueryClient();
  const savedViews = useSavedViews();
  const [viewId, setViewId] = useState('');

  function applyView(id: string) {
    setViewId(id);
    const view = savedViews.data?.find((v) => v.id === id);
    if (!view) return;
    try {
      const def = JSON.parse(view.definition) as Partial<ViewDefinition>;
      if (typeof def.search === 'string') setSearch(def.search);
      if (def.level) setLevel(def.level);
      if (typeof def.includeArchived === 'boolean') setIncludeArchived(def.includeArchived);
    } catch {
      /* ignore a malformed saved definition */
    }
  }

  async function saveView() {
    const name = window.prompt('Name this view:')?.trim();
    if (!name) return;
    const definition: ViewDefinition = { search, level, includeArchived };
    await createSavedView(name, definition);
    await queryClient.invalidateQueries({ queryKey: ['saved-views'] });
  }

  async function removeView() {
    if (!viewId) return;
    await deleteSavedView(viewId);
    setViewId('');
    await queryClient.invalidateQueries({ queryKey: ['saved-views'] });
  }

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (repositories.data ?? []).filter((repo) => {
      if (level !== 'all' && repo.attentionLevel !== level) return false;
      if (term && !repo.fullName.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [repositories.data, search, level]);

  const virtualize = filtered.length > VIRTUALIZE_ABOVE;
  const win = useVirtualWindow(filtered.length, ROW_HEIGHT, VIEWPORT_HEIGHT);
  const visibleRepos = virtualize ? filtered.slice(win.start, win.end) : filtered;

  return (
    <>
      <h1 className="page-title">Repositories</h1>
      <p className="page-subtitle">
        {repositories.data ? `${filtered.length} of ${repositories.data.length} repositories` : ' '}
      </p>

      <div className="toolbar">
        <input
          type="search"
          placeholder="Filter by name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={level} onChange={(e) => setLevel(e.target.value as (typeof LEVELS)[number])}>
          {LEVELS.map((l) => (
            <option key={l} value={l}>
              {l === 'all' ? 'All attention levels' : l}
            </option>
          ))}
        </select>
        <label className="muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />
          Include archived
        </label>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button className="ghost" onClick={() => exportJson(filtered)}>
            Export JSON
          </button>
          <button className="ghost" onClick={() => exportCsv(filtered)}>
            CSV
          </button>
          <button className="ghost" onClick={() => exportMarkdown(filtered)}>
            Markdown
          </button>
        </span>
      </div>

      <div className="toolbar">
        <span className="muted">Saved views:</span>
        <select value={viewId} onChange={(e) => applyView(e.target.value)}>
          <option value="">— select a view —</option>
          {(savedViews.data ?? []).map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
        <button className="ghost" onClick={saveView}>
          Save current view
        </button>
        {viewId && (
          <button className="ghost" onClick={removeView}>
            Delete
          </button>
        )}
      </div>

      <div
        className="panel table-scroll"
        style={virtualize ? { maxHeight: VIEWPORT_HEIGHT, overflowY: 'auto' } : undefined}
        onScroll={virtualize ? win.onScroll : undefined}
      >
        <table className="data">
          <thead>
            <tr>
              <th>Repository</th>
              <th>Attention</th>
              <th>Default branch</th>
              <th>Branch state</th>
              <th>Pipeline</th>
              <th>PRs</th>
              <th>Last activity</th>
              <th>Synced</th>
            </tr>
          </thead>
          <tbody>
            {repositories.isLoading && (
              <tr>
                <td colSpan={8} className="muted">
                  Loading…
                </td>
              </tr>
            )}
            {virtualize && win.padTop > 0 && (
              <tr aria-hidden>
                <td colSpan={8} style={{ height: win.padTop, padding: 0, border: 'none' }} />
              </tr>
            )}
            {visibleRepos.map((repo) => (
              <tr key={repo.id}>
                <td>
                  <Link to={`/repositories/${repo.id}`}>{repo.fullName}</Link>
                  {repo.status === 'inaccessible' && (
                    <span className="badge outline" style={{ marginLeft: 6 }}>
                      inaccessible
                    </span>
                  )}
                  {repo.isArchived && (
                    <span className="badge outline" style={{ marginLeft: 6 }}>
                      archived
                    </span>
                  )}
                  <div className="muted">{repo.primaryLanguage ?? ''}</div>
                </td>
                <td>
                  <AttentionBadge level={repo.attentionLevel} />
                </td>
                <td className="mono">{repo.defaultBranch ?? '—'}</td>
                <td>
                  <BranchStatusBadge status={repo.defaultBranchStatus} />
                  {repo.branchesAhead > 0 && (
                    <div className="muted">{repo.branchesAhead} ahead</div>
                  )}
                </td>
                <td>
                  <RunBadge conclusion={repo.latestRunConclusion} at={repo.latestRunAt} />
                </td>
                <td>{repo.openChangeRequests}</td>
                <td>{timeAgo(repo.pushedAt)}</td>
                <td className="muted">{timeAgo(repo.lastSyncedAt)}</td>
              </tr>
            ))}
            {virtualize && win.padBottom > 0 && (
              <tr aria-hidden>
                <td colSpan={8} style={{ height: win.padBottom, padding: 0, border: 'none' }} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
