import { Link } from 'react-router-dom';
import { useEstateBranches } from '../api/client';
import { timeAgo } from '../lib/format';

export function Branches() {
  const branches = useEstateBranches();

  return (
    <>
      <h1 className="page-title">Branches</h1>
      <p className="page-subtitle">
        Every active branch ahead of or diverged from its default branch, estate-wide.
      </p>

      <div className="panel table-scroll">
        <table className="data">
          <thead>
            <tr>
              <th>Repository</th>
              <th>Branch</th>
              <th>State</th>
              <th>Ahead</th>
              <th>Behind</th>
              <th>PR/MR</th>
              <th>Head age</th>
            </tr>
          </thead>
          <tbody>
            {branches.isLoading && (
              <tr>
                <td colSpan={7} className="muted">
                  Loading…
                </td>
              </tr>
            )}
            {branches.data?.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  No branches are ahead of their default branch. Everything is merged.
                </td>
              </tr>
            )}
            {branches.data?.map((branch) => (
              <tr key={`${branch.repositoryId}-${branch.name}`}>
                <td>
                  <Link to={`/repositories/${branch.repositoryId}`}>
                    {branch.repositoryFullName}
                  </Link>
                  <span className="badge outline" style={{ marginLeft: 6 }}>
                    {branch.provider}
                  </span>
                </td>
                <td className="mono">{branch.name}</td>
                <td>
                  <span className={`badge ${branch.comparisonStatus === 'diverged' ? 'high' : 'medium'}`}>
                    {branch.comparisonStatus}
                  </span>
                </td>
                <td>{branch.aheadBy ?? '—'}</td>
                <td>{branch.behindBy ?? '—'}</td>
                <td>
                  {branch.openChangeRequestNumber ? (
                    `#${branch.openChangeRequestNumber}`
                  ) : (
                    <span className="badge medium">untracked</span>
                  )}
                </td>
                <td>{timeAgo(branch.headCommittedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
