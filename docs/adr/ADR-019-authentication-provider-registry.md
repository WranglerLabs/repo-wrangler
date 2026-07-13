# ADR-019: Authentication provider registry

- **Status:** Accepted
- **Date:** 2026-07-13
- **Supersedes the single-mode selector of** [ADR-016 (Entra ID sign-in)](ADR-016-entra-id-authentication.md)
- **Relates to:** [ADR-013 (platform-neutral architecture)](ADR-013-platform-neutral-architecture.md)

## Context

ADR-016 added Entra sign-in as a second option behind a binary `AUTH_MODE`
selector (`github_app` | `entra`). But ADR-013's authentication matrix lists
**five** identity sources behind `IAuthenticationProvider` — GitHub OAuth, GitLab
OAuth, Microsoft Entra ID, Google, and local-dev — and treats them as peers.
Entra is one row in that matrix, not "the" alternative to GitHub. A one-of-two
switch cannot express "enable GitHub **and** Google", and it framed sign-in as a
mode rather than a set of swappable providers (PN-5).

## Decision

Introduce an explicit **provider registry**. Every identity source implements one
`AuthProvider` shape — `id`, display `label`, `isConfigured(env)`, and a Hono
router mounting `/{id}/login` and `/{id}/callback` — and they all converge on one
shared `completeSignIn` (allowlist → role → signed session cookie → audit). GitHub
and Entra were refactored onto it; **GitLab OAuth, Google OIDC, and local-dev**
were added.

- **Selection is two-step:** `AUTH_PROVIDERS` (an ordered CSV of ids) chooses
  which are *enabled*; the registry then keeps only those that are *configured*.
  When `AUTH_PROVIDERS` is unset, the legacy `AUTH_MODE` still selects a single
  provider, so existing deployments keep working.
- **`/auth/config`** now returns one entry per enabled+configured provider
  (`id`, `label`, `loginUrl`); the SPA renders a button for each. It no longer
  returns a single `mode`.
- **Local-dev is special-cased:** password-less, so it is only ever available when
  explicitly named in `AUTH_PROVIDERS` *and* `LOCAL_DEV_USERS` is set — never via
  the `AUTH_MODE` fallback. Its POST is guarded by a signed state token.
- **Uniform allowlist rule:** for every provider, `*_ALLOWED_USERS` (or
  `LOCAL_DEV_USERS`) is a CSV where the first principal is the owner and the rest
  are admins — identical semantics across GitHub/GitLab/Entra/Google/local.
- **Runtime-neutral:** providers use only Web Crypto and `fetch`, so they run on
  both the Worker and the Node host (ADR-013). OIDC providers (Entra, Google)
  validate issuer, audience, expiry, and a login nonce; OAuth providers (GitHub,
  GitLab) identify the user via the provider's user API and discard the token.

## Consequences

- **Positive:** operators can enable any combination of sign-in methods; the login
  screen adapts automatically. Full PN-5 coverage — auth is now genuinely
  "everything is a provider", not a mode.
- **Migration:** `AUTH_MODE` remains honoured as a fallback, so no existing config
  breaks; new deployments should prefer `AUTH_PROVIDERS`.
- **SPA contract change:** `/auth/config` shape changed from `{ mode }` to
  `{ demo, providers[] }`; the bundled SPA was updated in lockstep.
- **Verification:** unit tests cover fallback, multi-provider ordering, the
  configured-filter, the local-dev gate, and the `/auth/config` payload; a live
  boot serves `/auth/config` with the enabled set.
