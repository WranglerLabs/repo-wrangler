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
 *                                  code (valid one hour). The page immediately
 *                                  POSTs it to POST /api/v1/connections/github/exchange
 *                                  (same origin, so the wizard's session cookie
 *                                  rides along) and redirects to /onboarding on
 *                                  success — no copy/paste needed. If that call
 *                                  fails (e.g. this browser has no wizard
 *                                  session), the page falls back to showing the
 *                                  code with a copy button.
 *
 * The pages hold no secrets: the manifest is public configuration, and the
 * temporary code is only shown back to the browser that created the app.
 */
export const setupRoutes = new Hono<AppContext>();

const NAME_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

/**
 * A short random suffix for the suggested App name. `RepoWrangler` alone is
 * reserved (`@repowrangler` already exists on GitHub) and gets rejected on
 * the review screen, so every manifest suggests a unique-enough default —
 * the operator can still rename it there before creating the app.
 */
function randomSuffix(): string {
  const length = 4 + Math.floor(Math.random() * 3); // 4-6 chars
  let out = '';
  for (let i = 0; i < length; i++) {
    out += NAME_CHARS[Math.floor(Math.random() * NAME_CHARS.length)];
  }
  return out;
}

function manifestJson(origin: string): string {
  return JSON.stringify({
    name: `repo-wrangler-${randomSuffix()}`,
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
  const nonce = c.get('cspNonce');
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
    <label>Organization login: <input type="text" id="orgName" value="" placeholder="your-org-login" required></label>
    <button type="submit">Create App (organization)</button>
  </form>
  <p><small>You must be an <strong>owner</strong> of the organization — GitHub shows a 404
  page (not "access denied") if you are not, or if the name has a typo.</small></p>
  <script nonce="${nonce}">
    document.getElementById('orgForm').addEventListener('submit', function (e) {
      var org = document.getElementById('orgName').value.trim();
      if (!org) {
        e.preventDefault();
        alert('Enter the organization login first.');
        return;
      }
      this.action = 'https://github.com/organizations/' + encodeURIComponent(org) + '/settings/apps/new';
    });
  </script>

  <p>GitHub will show the app for review with a suggested name like
  <code>repo-wrangler-a1b2c3</code> (randomized so it never collides with an existing
  app — rename it to whatever you like on that screen), then redirect back here.</p>
</body></html>`);
});

setupRoutes.get('/github-app/callback', (c) => {
  const code = c.req.query('code') ?? '';
  const safe = code.replace(/[^A-Za-z0-9_-]/g, '');
  const nonce = c.get('cspNonce');
  return c.html(`<!doctype html>
<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>RepoWrangler — app created</title><style>${PAGE_STYLE}</style></head>
<body>
  <h1>App created ✓</h1>
  ${
    safe
      ? `<p id="status">Finishing setup — connecting the app to RepoWrangler…</p>
         <div id="fallback" style="display:none">
           <p id="fallbackMessage"></p>
           <p>Copy this one-time setup code (valid for <strong>1 hour</strong>):</p>
           <div class="code-box" id="codeBox">${safe}</div>
           <button type="button" id="copyBtn">Copy code</button>
           <p><small>On a phone, or if this is a different browser tab than your setup
           session: return to the RepoWrangler tab → <strong>Connect your estate</strong> →
           <strong>“I have a setup code”</strong> → paste it there.</small></p>
         </div>
         <script nonce="${nonce}">
           (function () {
             var code = ${JSON.stringify(safe)};
             var statusEl = document.getElementById('status');
             var fallbackEl = document.getElementById('fallback');
             var fallbackMessageEl = document.getElementById('fallbackMessage');
             var settled = false;
             // Belt-and-suspenders: whatever happens to the fetch below — it
             // resolves, rejects, or the browser never lets it finish (CSP,
             // a hung connection, a client that blocks fetch) — the operator
             // still sees the copy-button fallback within 8s instead of a
             // page that "just sits there" forever.
             var watchdog = setTimeout(function () {
               showFallback('Automatic setup is taking longer than expected — complete it manually below.');
             }, 8000);
             function showFallback(message) {
               if (settled) return;
               settled = true;
               clearTimeout(watchdog);
               statusEl.style.display = 'none';
               fallbackMessageEl.textContent = message;
               fallbackEl.style.display = 'block';
             }
             fetch('/api/v1/connections/github/exchange', {
               method: 'POST',
               credentials: 'same-origin',
               headers: { 'content-type': 'application/json' },
               body: JSON.stringify({ code: code }),
             }).then(function (res) {
               if (res.ok) {
                 settled = true;
                 clearTimeout(watchdog);
                 window.location.href = '/onboarding';
                 return;
               }
               return res.text().then(function (body) {
                 var detail = '';
                 try {
                   detail = JSON.parse(body).error || '';
                 } catch (e) {
                   detail = body;
                 }
                 showFallback(
                   'Automatic setup did not finish' + (detail ? ' (' + detail + ')' : '') + ' — complete it manually below.',
                 );
               });
             }).catch(function () {
               showFallback('Automatic setup did not finish — complete it manually below.');
             });
             document.getElementById('copyBtn').addEventListener('click', function () {
               var btn = this;
               var box = document.getElementById('codeBox');
               function selectBox() {
                 var range = document.createRange();
                 range.selectNodeContents(box);
                 var selection = window.getSelection();
                 selection.removeAllRanges();
                 selection.addRange(range);
               }
               if (navigator.clipboard && navigator.clipboard.writeText) {
                 navigator.clipboard.writeText(code).then(function () {
                   btn.textContent = 'Copied ✓';
                 }, selectBox);
               } else {
                 selectBox();
               }
             });
           })();
         </script>`
      : `<p>No code found in the redirect. Restart from <a href="/setup/github-app">the setup page</a>.</p>`
  }
</body></html>`);
});
