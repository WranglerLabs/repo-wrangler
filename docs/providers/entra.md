# Provider: Microsoft Entra ID sign-in

RepoWrangler can gate dashboard sign-in on **Microsoft Entra ID** (Azure AD)
instead of GitHub, so staff sign in with their existing corporate identity — with
your directory's conditional-access and MFA already enforced. This is the
`AUTH_MODE=entra` path ([ADR-016](../adr/ADR-016-entra-id-authentication.md)).

**Sign-in identity is independent of the monitored data.** Entra changes *who may
sign in*; the estate data still comes from your [GitHub App](github-app.md) and/or
[GitLab](gitlab.md). The Entra gate is meaningful in real mode (a data provider
configured); demo mode bypasses sign-in entirely.

## 1. Register an app in Entra

Azure portal → **Microsoft Entra ID → App registrations → New registration**:

1. **Name:** RepoWrangler (or your instance name).
2. **Supported account types:** single tenant (recommended) unless you need
   multi-tenant.
3. **Redirect URI:** platform **Web**, value
   `{PUBLIC_BASE_URL}/auth/entra/callback`
   (e.g. `https://repowrangler.example.com/auth/entra/callback`).
4. After creation, note the **Directory (tenant) ID** and **Application (client)
   ID** from Overview.
5. **Certificates & secrets → New client secret** — copy the secret **value**.
6. **API permissions:** delegated `openid`, `profile`, `email` (Microsoft Graph).
   Grant admin consent if your tenant requires it.

## 2. Configure

| Setting | Secret | Description |
|---|---|---|
| `AUTH_MODE` | no | Set to `entra`. |
| `ENTRA_TENANT_ID` | no | Directory (tenant) ID, or `organizations` / `common` for multi-tenant. |
| `ENTRA_CLIENT_ID` | no | Application (client) ID. |
| `ENTRA_CLIENT_SECRET` | **yes** | The client secret value from step 5. |
| `ENTRA_ALLOWED_USERS` | no | Comma-separated sign-in names (UPN/email) allowed in; **first = owner**, rest = admins. |

Also set `PUBLIC_BASE_URL` to the exact instance URL — it must match the
registered redirect URI. Wire `ENTRA_CLIENT_SECRET` through your platform's secret
store (Key Vault on Azure Container Apps, a K8s `Secret`, `.env` for Docker,
`wrangler secret put` on Cloudflare).

## 3. Sign in

Visit your instance — the button now reads **Sign in with Microsoft**
(the SPA reads `/auth/config`). You are redirected to Entra, and after consent
returned to RepoWrangler with a session. Accounts not on `ENTRA_ALLOWED_USERS` are
denied and the attempt is audited.

## How it works

The OpenID Connect authorization-code flow exchanges the code for an ID token over
a back-channel authenticated with the client secret. RepoWrangler validates the
token's **issuer, audience, expiry, and a login-bound nonce** and the OAuth
`state`, then issues the same signed session cookie the GitHub path uses — so
roles, `/auth/me`, and the whole app behave identically. No Cloudflare/Node-
specific code is used, so Entra sign-in works on every target.

## Troubleshooting

- **`AADSTS50011` redirect mismatch** — the registered redirect URI must exactly
  equal `{PUBLIC_BASE_URL}/auth/entra/callback`, including scheme and host.
- **"not authorized for this instance"** — the signed-in UPN/email is not in
  `ENTRA_ALLOWED_USERS`.
- **Button still says GitHub** — `AUTH_MODE` is not `entra`, or the SPA cached the
  old `/auth/config`; hard-refresh.
- More in [troubleshooting.md](../troubleshooting.md).
