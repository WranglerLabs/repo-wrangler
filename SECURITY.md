# Security policy

## Supported versions

Only the latest release of RepoWrangler receives security fixes.

## Reporting a vulnerability

Please use **GitHub private vulnerability reporting** on this repository
(Security → Report a vulnerability). Do not open a public issue for a
security problem.

You can expect an acknowledgement within 7 days.

## Scope notes for operators

- RepoWrangler is **read-only** toward your providers by design. The GitHub
  App should be configured with read permissions only.
- Secrets (GitHub App private key, webhook secret, OAuth client secret,
  session secret) belong exclusively in Cloudflare secret storage. They are
  never written to D1, Git, logs, or exports.
- Webhooks are validated with `X-Hub-Signature-256` before parsing; deliveries
  are deduplicated by delivery ID.
- Security findings are stored as **redacted metadata only** — never secret
  values or code snippets.
- A public demo must use synthetic data and a separate deployment; never share
  D1 or secrets with a real instance.
