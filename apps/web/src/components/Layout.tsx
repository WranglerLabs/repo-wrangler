import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useSessionUser } from '../api/client';

const NAV_ITEMS = [
  { to: '/', label: 'Command Center' },
  { to: '/repositories', label: 'Repositories' },
  { to: '/branches', label: 'Branches' },
  { to: '/change-requests', label: 'Change Requests' },
  { to: '/workspaces', label: 'Workspaces' },
  { to: '/platform', label: 'Platform Health' },
  { to: '/credits', label: 'About & Credits' },
];

function useTheme(): [string, () => void] {
  const [theme, setTheme] = useState(
    () =>
      localStorage.getItem('rw-theme') ??
      (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
  );
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('rw-theme', theme);
  }, [theme]);
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))];
}

export function Layout() {
  const [theme, toggleTheme] = useTheme();
  const { data: user } = useSessionUser();

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <img src="/lasso.svg" alt="" width={26} height={26} />
          RepoWrangler
        </div>
        <nav>
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="footer">
          {user ? (
            <div>
              {user.login} ({user.role}){user.demo ? ' · demo' : ''}
            </div>
          ) : (
            <a href="/auth/github/login" style={{ color: '#e0b45e' }}>
              Sign in with GitHub
            </a>
          )}
          <button
            className="ghost"
            style={{ marginTop: 8, color: '#d9dfd5', borderColor: '#3a5949' }}
            onClick={toggleTheme}
          >
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
        </div>
      </aside>
      <main className="main">
        {user?.demo && (
          <div className="demo-banner">
            Demo mode — synthetic data. Configure a GitHub App to monitor your real estate.
          </div>
        )}
        <Outlet />
      </main>
    </div>
  );
}
