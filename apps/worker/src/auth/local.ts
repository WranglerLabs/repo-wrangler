import { Hono } from 'hono';
import { isDemoMode, type Env } from '../bindings';
import type { AppContext } from '../middleware/auth';
import { createStateToken, verifyStateToken } from '../lib/session';
import {
  clearTransientCookie,
  completeSignIn,
  readCookie,
  transientCookie,
  type AuthProvider,
} from './types';

/**
 * Local-development sign-in (ADR-019, PN-5) — NOT for production.
 *
 * A password-less sign-in for local evaluation: pick any name on the
 * `LOCAL_DEV_USERS` allowlist and you are signed in. There is no external
 * identity provider, so it must only ever be enabled deliberately (listed in
 * `AUTH_PROVIDERS` *and* `LOCAL_DEV_USERS` populated). The registry never
 * auto-enables it. A signed state token guards the POST against drive-by CSRF.
 */
export const localAuthRoutes = new Hono<AppContext>();

const STATE_COOKIE = 'rw_local_state';

/** Local dev requires an allowlist AND being explicitly named in AUTH_PROVIDERS. */
export function isLocalDevConfigured(env: Env): boolean {
  if (!env.LOCAL_DEV_USERS || !env.LOCAL_DEV_USERS.trim()) return false;
  const enabled = (env.AUTH_PROVIDERS ?? '')
    .split(',')
    .map((t) => t.trim().toLowerCase());
  return enabled.includes('local');
}

function loginForm(state: string, users: string[]): string {
  const escapeHtml = (value: string) => value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  const options = users
    .map((user) => {
      const escaped = escapeHtml(user);
      return `<option value="${escaped}">${escaped}</option>`;
    })
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Local sign-in</title></head>
<body style="font-family:system-ui;max-width:24rem;margin:4rem auto">
<h1>RepoWrangler — local sign-in</h1>
<p style="color:#b45309">Development sign-in. Do not enable in production.</p>
<form method="post" action="/auth/local/login">
<input type="hidden" name="state" value="${escapeHtml(state)}">
<label>User <select name="user">${options}</select></label>
<button type="submit">Sign in</button>
</form></body></html>`;
}

localAuthRoutes.get('/local/login', async (c) => {
  if (isDemoMode(c.env)) return c.redirect('/');
  const secret = c.env.SESSION_SECRET;
  if (!secret || !isLocalDevConfigured(c.env)) {
    return c.json({ error: 'Local sign-in is not configured.' }, 500);
  }
  const users = (c.env.LOCAL_DEV_USERS ?? '')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);
  const state = await createStateToken(secret);
  c.header('Set-Cookie', transientCookie(STATE_COOKIE, state));
  return c.html(loginForm(state, users));
});

localAuthRoutes.post('/local/login', async (c) => {
  if (isDemoMode(c.env)) return c.redirect('/');
  const secret = c.env.SESSION_SECRET;
  if (!secret || !isLocalDevConfigured(c.env)) {
    return c.json({ error: 'Local sign-in is not configured.' }, 500);
  }
  const form = await c.req.formData();
  const state = String(form.get('state') ?? '');
  const user = String(form.get('user') ?? '').trim();
  const cookieState = readCookie(c.req.header('cookie'), STATE_COOKIE);
  if (!state || state !== cookieState || !(await verifyStateToken(secret, state))) {
    return c.json({ error: 'Invalid sign-in state.' }, 400);
  }
  if (!user) {
    return c.json({ error: 'No user selected.' }, 400);
  }
  c.header('Set-Cookie', clearTransientCookie(STATE_COOKIE), { append: true });
  return completeSignIn(c, {
    provider: 'local',
    identity: user,
    allowedUsers: c.env.LOCAL_DEV_USERS,
  });
});

export const localProvider: AuthProvider = {
  id: 'local',
  label: 'Local dev',
  isConfigured: isLocalDevConfigured,
  routes: localAuthRoutes,
};
