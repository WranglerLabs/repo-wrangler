import { useAuthConfig, useCredits } from '../api/client';

export function Credits() {
  const credits = useCredits();
  const { data: authConfig } = useAuthConfig();

  return (
    <>
      <h1 className="page-title">About &amp; Credits</h1>
      {authConfig?.version ? (
        <p className="badge info" style={{ display: 'inline-block' }}>
          RepoWrangler v{authConfig.version}
        </p>
      ) : null}
      <p className="page-subtitle">
        RepoWrangler is open source under the Apache License 2.0. No code from these projects was
        copied — they were studied as references and inspiration while RepoWrangler was built from
        scratch. Credited here with thanks.
      </p>

      {credits.data?.projects.map((project) => (
        <div className="panel" key={project.name}>
          <h2>
            <a href={project.upstream} target="_blank" rel="noreferrer">
              {project.name} ↗
            </a>
          </h2>
          <table className="data">
            <tbody>
              <tr>
                <td className="muted" style={{ width: 160 }}>
                  License
                </td>
                <td>{project.license}</td>
              </tr>
              <tr>
                <td className="muted">Copyright</td>
                <td>{project.copyright}</td>
              </tr>
              <tr>
                <td className="muted">Reviewed commit</td>
                <td className="mono">{project.commit}</td>
              </tr>
              <tr>
                <td className="muted">What was reused</td>
                <td>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {project.usage.map((usage) => (
                      <li key={usage}>{usage}</li>
                    ))}
                  </ul>
                </td>
              </tr>
              <tr>
                <td className="muted">Copied files</td>
                <td>{project.copiedFiles.length === 0 ? 'None' : project.copiedFiles.join(', ')}</td>
              </tr>
              <tr>
                <td className="muted">Modifications</td>
                <td>{project.modifications}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ))}

      <div className="panel">
        <h2>RepoWrangler</h2>
        <p>
          Wrangle every repository into one clear view.{' '}
          <a
            href="https://github.com/Hybrid-Solutions-Cloud/repo-wrangler"
            target="_blank"
            rel="noreferrer"
          >
            Source, issues, and contributions on GitHub ↗
          </a>
        </p>
      </div>
    </>
  );
}
