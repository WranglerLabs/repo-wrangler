# ADR-016: Microsoft Entra ID sign-in

- **Status:** Accepted
- **Date:** 2026-07-13
- **Relates to:** [ADR-003 (read-only GitHub App)](README.md),
  [ADR-010 (single-tenant first)](README.md),
  [ADR-013 (platform-neutral architecture)](ADR-013-platform-neutral-architecture.md)

## Context

Dashboard sign-in was GitHub-only: the operator authenticated through the GitHub
App's user-authorization (OAuth) flow, and an allowlist of GitHub logins gated
access. That is a natural fit when the monitored estate is GitHub, but many
organisations — especially those deploying to Azure — want staff to sign in with
their existing **Microsoft Entra ID** (Azure AD) identity, not a GitHub account.
Sign-in identity and the monitored data provider are independent concerns: a team
might watch a GitHub estate while signing in with Entra.

## Decision

Add an Entra ID sign-in provider selected by `AUTH_MODE=entra`, alongside the
default `github_app`. It uses the standard OpenID Connect **authorization-code
flow** and issues the **same signed session cookie** as the GitHub path, so
everything downstream — session middleware, roles, `/auth/me`, the SPA — is
unchanged. An allowlist of Entra sign-in names (`ENTRA_ALLOWED_USERS`, UPN/email)
gates access; the first to sign in becomes the owner, the rest are admins,
mirroring the GitHub convention.

Design points:

- **Back-channel trust.** The ID token is obtained directly from the Entra token
  endpoint over TLS, authenticated with the app's client secret. Per OpenID
  Connect §3.1.3.7 a token received this way may be trusted without re-validating
  its signature; the provider still checks **issuer, audience, expiry, and a
  login-bound nonce**, and verifies the OAuth `state`.
- **No Cloudflare/Node-specific code.** Only Web Crypto and `fetch` are used, so
  the provider runs identically on the Cloudflare Worker and the Node host —
  consistent with ADR-013.
- **Auth ≠ data.** Entra changes *who may sign in*, not *what data is shown*.
  Demo mode (no data provider) still bypasses auth; the Entra gate is meaningful
  once a real data provider (GitHub App / GitLab) is configured.
- **Public config endpoint.** `/auth/config` returns the active mode so the SPA
  renders the correct button ("Sign in with Microsoft" vs "…with GitHub") without
  a session.

## Consequences

- **Positive:** organisations can gate the dashboard on their corporate Entra
  directory with conditional-access, MFA, and lifecycle already enforced by
  Entra. A natural pairing with the Azure Container Apps deployment.
- **Config:** four settings — `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`,
  `ENTRA_CLIENT_SECRET`, `ENTRA_ALLOWED_USERS` — plus a redirect URI of
  `{PUBLIC_BASE_URL}/auth/entra/callback` registered on the Entra app.
- **Seam for more providers.** The `AUTH_MODE` switch + shared session cookie is
  the `IAuthenticationProvider` seam (PN-5); Google/GitLab/local-dev sign-in can
  follow the same shape.
- **Verification:** typecheck and the full build pass; the OIDC redirect and
  token exchange against a live Entra tenant are validated by the deployer, since
  they require a real directory.
