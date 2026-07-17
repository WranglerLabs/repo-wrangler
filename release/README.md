# Release contracts

This directory owns the machine-readable contracts used by deployment tools such as [Ranch Hand](https://github.com/WranglerLabs/ranch-hand). RepoWrangler remains deployable with a clone, fork, or an operator's own automation; these contracts add a verified artifact path without replacing existing methods.

## Release manifest

Every Ranch Hand-compatible RepoWrangler release must publish `release-manifest.json` as an immutable GitHub release asset. Each target artifact records its HTTPS URL, exact byte size, and lowercase SHA-256 digest. Production publication will also provide an SBOM and GitHub artifact attestation for each executable bundle.

The manifest and every referenced artifact are immutable. `latest`, moving branches, unpinned container tags, and an asset whose size or digest differs from the manifest are invalid inputs.

Generate a manifest from a secret-free specification:

```bash
node scripts/release/generate-release-manifest.mjs \
  --spec path/to/release-artifacts.json \
  --output dist/release-manifest.json
```

The specification contains `version`, `releasedAt`, and one or more artifacts with `target`, local `path`, public `url`, and optional `mediaType`, `attestationUrl`, and `sbomUrl`. The generator derives size and SHA-256 from the files; callers must not supply those values.

## Deployment plan

`deployment-plan.schema.json` describes a portable Ranch Hand plan. Plans select one explicit release and one supported target. They may contain non-sensitive configuration such as region and resource names, but never passwords, tokens, private keys, client secrets, or other credentials.

Secrets are collected only during apply and sent directly to the target's supported secret mechanism. The example is intentionally non-deployable until its release has a published manifest.
