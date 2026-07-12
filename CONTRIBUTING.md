# Contributing to RepoWrangler

Thanks for helping wrangle repositories!

## Ground rules

- **Provider-neutral core.** The UI, domain, and persistence layers never
  import raw GitHub/GitLab response types. All provider payloads are mapped in
  `packages/provider-*` adapters.
- **Capability honesty.** Missing data is a capability state
  (`not_authorized`, `unsupported_by_plan`, …) — never a false zero.
- **Free-tier discipline.** Collection work must be bounded and checkpointed.
  No unbounded loops over the estate in one invocation.
- **Read-only.** No provider write operations. Remediation features have a
  separate design (ADR-008).
- **Provenance.** Copying code from another project requires license
  compatibility, source comments with upstream path + commit, and an entry in
  `credits.yaml` — see `THIRD_PARTY_NOTICES.md`.

## Development

```bash
pnpm install
cp .dev.vars.example .dev.vars   # DEMO_MODE=true works with zero secrets
pnpm db:migrate:local
pnpm dev                          # Worker + assets on http://localhost:8787
pnpm dev:web                      # optional: Vite dev server with HMR on :5173
```

Quality gates (run before pushing):

```bash
pnpm typecheck
pnpm test
pnpm build
```

## Pull requests

- Branch from `main`; keep branches short-lived.
- Conventional commits: `type(scope): description`
  (`feat`, `fix`, `docs`, `chore`, `refactor`, `test`).
- Sign off your commits (DCO): `git commit -s`.
- Include tests for domain rules and webhook translation changes.
- CI must pass: typecheck, tests, build.

## Releases

Semantic versioning with tags `vMAJOR.MINOR.PATCH`. Database migrations are
immutable once released; new schema changes get new migration files.
