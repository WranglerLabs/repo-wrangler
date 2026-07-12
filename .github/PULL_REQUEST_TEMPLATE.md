## What

Summary of the change and why it's needed. Link related issues (`Fixes #123`).

## Checklist

- [ ] `pnpm typecheck`, `pnpm test`, and `pnpm build` pass locally
- [ ] Conventional commit title (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`)
- [ ] No secrets, tokens, or private estate data in code, fixtures, or tests
- [ ] Provider responses stay behind adapters — no raw Octokit/GitLab types in domain or UI
- [ ] Missing provider data surfaces as a capability state, never a false zero
- [ ] New/changed behavior covered by tests where practical
- [ ] Copied or adapted third-party code recorded in `credits.yaml` with license/provenance
