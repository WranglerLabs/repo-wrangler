import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { signInFor, useAuthConfig, useSessionUser } from '../api/client';
import { AVAILABLE_THEMES, resolveInitialTheme } from '../themes/registry';
import {
  CUSTOM_THEME_ID,
  applyCustomPalette,
  clearCustomPalette,
  loadCustomPalette,
} from '../themes/custom';

const NAV_ITEMS = [
  { to: '/', label: 'Command Center' },
  { to: '/repositories', label: 'Repositories' },
  { to: '/workspaces', label: 'Workspaces' },
  { to: '/branches', label: 'Branches' },
  { to: '/pipelines', label: 'Pipelines' },
  { to: '/change-requests', label: 'Change Requests' },
  { to: '/security', label: 'Security' },
  { to: '/budgets', label: 'Budgets & Usage' },
  { to: '/activity', label: 'Activity' },
  { to: '/platform', label: 'Platform Health' },
  { to: '/admin', label: 'Administration' },
  { to: '/credits', label: 'About & Credits' },
];

function useTheme(): [string, (id: string) => void] {
  const [theme, setTheme] = useState(() => resolveInitialTheme(localStorage.getItem('rw-theme')));
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('rw-theme', theme);
    if (theme === CUSTOM_THEME_ID) applyCustomPalette(loadCustomPalette());
    else clearCustomPalette();
  }, [theme]);
  return [theme, setTheme];
}

export function Layout() {
  const [theme, setTheme] = useTheme();
  const { data: user } = useSessionUser();
  const { data: authConfig } = useAuthConfig();
  const signIn = signInFor(authConfig);

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
            <a href={signIn.href} style={{ color: '#e0b45e' }}>
              {signIn.label}
            </a>
          )}
          <label className="theme-picker">
            <span>Theme</span>
            <select
              value={theme}
              aria-label="Theme"
              onChange={(e) => setTheme(e.target.value)}
            >
              {AVAILABLE_THEMES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            <NavLink to="/theme" className="theme-studio-link">
              Customize colors →
            </NavLink>
          </label>
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
