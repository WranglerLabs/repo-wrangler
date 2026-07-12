import { Hono } from 'hono';
import type { AppContext } from '../middleware/auth';

/**
 * GitHub App Manifest flow (one-tap app creation).
 *
 * GET /setup/github-app          — page with a pre-filled manifest form; the
 *                                  operator taps one button and GitHub creates
 *                                  a dedicated, fully configured RepoWrangler
 *                                  App (permissions, events, webhook + secret).
 * GET /setup/github-app/callback — GitHub redirects here with a temporary
 *                                  code; the operator exchanges it (within one
 *                                  hour) via POST /app-manifests/{code}/conversions
 *                                  to receive the app credentials.
 *
 * The pages hold no secrets: the manifest is public configuration, and the
 * temporary code is only shown back to the browser that created the app.
 */
export const setupRoutes = new Hono<AppContext>();

function manifestJson(origin: string): string {
  return JSON.stringify({
    name: 'RepoWrangler',
    url: 'https://github.com/Hybrid-Solutions-Cloud/repo-wrangler',
    hook_attributes: { url: `${origin}/webhooks/github`, active: true },
    redirect_url: `${origin}/setup/github-app/callback`,
    callback_urls: [`${origin}/auth/github/callback`],
    // Public so the app is installable on every estate org, not only the
    // owning account — "public" only affects who may install, nothing else.
    public: true,
    default_permissions: {
      metadata: 'read',
      contents: 'read',
      actions: 'read',
      checks: 'read',
      statuses: 'read',
      pull_requests: 'read',
      administration: 'read',
      security_events: 'read',
      vulnerability_alerts: 'read',
      secret_scanning_alerts: 'read',
      organization_administration: 'read',
      members: 'read',
    },
    default_events: [
      'repository',
      'push',
      'create',
      'delete',
      'pull_request',
      'pull_request_review',
      'workflow_run',
      'workflow_job',
      'check_run',
      'check_suite',
      'branch_protection_rule',
      'repository_ruleset',
      'code_scanning_alert',
      'dependabot_alert',
      'secret_scanning_alert',
    ],
  });
}

const PAGE_STYLE = `
  body { font-family: system-ui, sans-serif; max-width: 640px; margin: 40px auto; padding: 0 16px; line-height: 1.6; }
  h1 { font-size: 1.4rem; }
  input[type=text] { width: 100%; padding: 8px; font-size: 1rem; box-sizing: border-box; }
  button { padding: 10px 18px; font-size: 1rem; cursor: pointer; margin-top: 8px; }
  code { background: rgba(127,127,127,.15); padding: 2px 5px; border-radius: 4px; word-break: break-all; }
  .code-box { background: rgba(127,127,127,.15); padding: 12px; border-radius: 6px; font-family: monospace; word-break: break-all; user-select: all; }
`;

setupRoutes.get('/github-app', (c) => {
  const origin = c.env.PUBLIC_BASE_URL ?? new URL(c.req.url).origin;
  const manifest = manifestJson(origin).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return c.html(`<!doctype html>
<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>RepoWrangler — create GitHub App</title><style>${PAGE_STYLE}</style></head>
<body>
  <h1>Create the RepoWrangler GitHub App</h1>
  <p>This creates a dedicated <strong>read-only</strong> GitHub App with the webhook,
  permissions, and event subscriptions already configured. You must be signed in to
  GitHub in this browser.</p>

  <h2>Under your personal account</h2>
  <form action="https://github.com/settings/apps/new" method="post">
    <input type="hidden" name="manifest" value="${manifest}">
    <button type="submit">Create App (personal account)</button>
  </form>

  <h2>Under an organization</h2>
  <form id="orgForm" method="post">
    <input type="hidden" name="manifest" value="${manifest}">
    <label>Organization login: <input type="text" id="orgName" placeholder="Hybrid-Solutions-Cloud"></label>
    <button type="submit">Create App (organization)</button>
  </form>
  <script>
    document.getElementById('orgForm').addEventListener('submit', function () {
      var org = document.getElementById('orgName').value.trim();
      this.action = 'https://github.com/organizations/' + encodeURIComponent(org) + '/settings/apps/new';
    });
  </script>

  <p>GitHub will show the app for review (you can rename it if the name is taken),
  then redirect back here with a one-hour setup code.</p>
</body></html>`);
});

setupRoutes.get('/github-app/callback', (c) => {
  const code = c.req.query('code') ?? '';
  const safe = code.replace(/[^A-Za-z0-9_-]/g, '');
  return c.html(`<!doctype html>
<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>RepoWrangler — app created</title><style>${PAGE_STYLE}</style></head>
<body>
  <h1>App created ✓</h1>
  ${
    safe
      ? `<p>Copy this one-time setup code (valid for <strong>1 hour</strong>) and hand it to
         your setup session (e.g. tell Claude: <em>“finish the RepoWrangler app setup with code …”</em>):</p>
         <div class="code-box">${safe}</div>
         <p>The code is exchanged once via GitHub's
         <code>POST /app-manifests/{code}/conversions</code> for the app's credentials,
         which are then stored as Worker secrets. After that, install the app on your
         organizations with <strong>All repositories</strong>.</p>`
      : `<p>No code found in the redirect. Restart from <a href="/setup/github-app">the setup page</a>.</p>`
  }
</body></html>`);
});
