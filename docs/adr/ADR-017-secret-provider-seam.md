# ADR-017: Secret provider seam

- **Status:** Accepted
- **Date:** 2026-07-13
- **Relates to:** [ADR-013 (platform-neutral architecture)](ADR-013-platform-neutral-architecture.md),
  [ADR-014 (Node server host)](ADR-014-node-server-host.md)

## Context

RepoWrangler needs several secrets — the GitHub App key, session-signing secret,
OAuth client secrets, webhook secrets. On Cloudflare these arrive as Worker
secret bindings (`wrangler secret put`), which the app reads as properties of its
`Env`. The Node host read them straight from `process.env`. But the design's
supported targets store secrets very differently: environment variables, **Docker
secrets** and **Kubernetes secrets** (mounted as files), and **Azure Key Vault**
(fetched with a managed identity). Reading `process.env` directly pins the host to
one of those and violates the "Secret management must be abstracted behind an
interface" rule of ADR-013 (PN-4).

## Decision

Introduce `SecretProvider` — the `ISecretProvider` seam — in a new
`@repo-wrangler/secrets-core` package, with three concrete adapters and a
composite, selected on the Node host by `SECRET_SOURCE`:

- **`EnvSecretProvider`** (`env`, default) — reads a string bag: `process.env` on
  Node, the `Env` bindings object on Cloudflare (so Cloudflare/Worker secrets are
  just this adapter). Zero dependencies.
- **`FileSecretProvider`** (`file`) — reads `${SECRETS_DIR}/<name>` (default
  `/run/secrets`), covering both Docker and Kubernetes mounted secrets. Tries the
  exact env name, then the lower-kebab and lower-snake forms.
- **External vaults — no cloud privileged.** All SDK-free (only `fetch` + Web
  Crypto), each using that platform's native auth:
  - **`KeyVaultSecretProvider`** (`keyvault`) — Azure Key Vault via managed
    identity (Container Apps token endpoint → IMDS).
  - **`VaultSecretProvider`** (`vault`) — HashiCorp Vault KV v2 (the cloud-neutral
    option; runs self-hosted, on HCP, or any cloud).
  - **`AwsSecretsManagerProvider`** (`aws`) — AWS Secrets Manager, SigV4-signed
    with the standard AWS credentials/role.
  - **`GcpSecretManagerProvider`** (`gcp`) — Google Secret Manager, token from the
    GCP metadata server / workload identity.
  Env names map to each vault's key by lower-kebab convention
  (`GITHUB_CLIENT_SECRET` → `github-client-secret`).
- **`CompositeSecretProvider`** — tries providers in order, first defined wins.
  `SECRET_SOURCE=file`/`keyvault`/`composite` all fall through to env so local
  overrides and non-secret config keep working.

The host resolves the fixed set of secret slots through the provider **once at
boot** (`loadSecrets`) and hands the resolved values to `buildEnv`. Nothing above
the seam changes; only *where* a secret comes from does.

## Consequences

- **Positive:** the same build runs on a laptop (env), a Docker/K8s cluster
  (mounted files), or Azure (Key Vault + managed identity) with no code change —
  a real PN-4 realisation. No secret is ever read from a hard-coded source.
- **Security:** the Key Vault adapter never holds a static credential — it uses
  the platform's managed identity and caches the token until just before expiry.
  Provider labels logged at boot never include secret values.
- **Scope:** only the Node host wires the provider; on Cloudflare, secret bindings
  already *are* the env adapter, so no change is needed there.
- **Verification:** unit tests cover env/file/Key Vault (with an injected `fetch`)
  and the composite fall-through; a live boot with `SECRET_SOURCE=file` resolves a
  mounted `session-secret` and `cron-trigger-token` end-to-end.
