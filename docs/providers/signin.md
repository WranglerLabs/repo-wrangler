# Sign-in providers — GitLab, Google, local-dev

RepoWrangler's dashboard sign-in is a set of swappable providers (ADR-019). Enable
any combination with `AUTH_PROVIDERS` (ordered CSV of `github,gitlab,entra,google,local`);
each appears on the sign-in screen only when it is also configured. For every
provider, `*_ALLOWED_USERS` is a CSV where the **first principal is the owner** and
the rest are admins. Each registers a redirect URI of
`{PUBLIC_BASE_URL}/auth/<id>/callback`.

The provider id is signed into every session cookie. Removing a provider from
`AUTH_PROVIDERS` invalidates sessions issued by it immediately; users must sign
in through one of the remaining configured providers.

> **Maturity:** implemented and unit-tested; validate the flow against your
> identity provider before production (pre-1.0). GitHub and Entra have their own
> pages ([GitHub App](github-app.md), [Entra ID](entra.md)).

## GitLab (OAuth 2.0)

Works with gitlab.com or a self-managed instance (`GITLAB_BASE_URL`).

1. In GitLab, create an **OAuth application** (User Settings → Applications, or a
   group/instance application): redirect URI `{PUBLIC_BASE_URL}/auth/gitlab/callback`,
   scope **`read_user`**, confidential.
2. Configure:
   - `AUTH_PROVIDERS=…,gitlab`
   - `GITLAB_CLIENT_ID`, `GITLAB_CLIENT_SECRET`
   - `GITLAB_ALLOWED_USERS` (comma-separated GitLab usernames; first = owner)
   - `GITLAB_BASE_URL` if self-managed (default `https://gitlab.com`)

## Google (OpenID Connect)

The verified Google account email is the identity.

1. In Google Cloud → APIs & Services → Credentials, create an **OAuth 2.0 Client
   ID** (type: Web application): authorized redirect URI
   `{PUBLIC_BASE_URL}/auth/google/callback`.
2. Configure:
   - `AUTH_PROVIDERS=…,google`
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_ALLOWED_USERS` (comma-separated emails; first = owner)

## Local development (password-less) — DEV ONLY

A password-less sign-in for local evaluation. **Never enable in production.** It is
active only when `local` is in `AUTH_PROVIDERS` **and** `LOCAL_DEV_USERS` is set.

- `AUTH_PROVIDERS=…,local`
- `LOCAL_DEV_USERS` (comma-separated usernames offered on the form; first = owner)

Visit `/auth/local/login`, pick a user, and you are signed in — no external IdP.

## Validation

For each enabled provider, confirm `GET /auth/config` lists it, then complete a
sign-in and check `GET /auth/me` returns your login and role. A denied account
(not on the allowlist) is recorded as `login.denied` in the audit log.
