# RepoWrangler — Claude Code

@AGENTS.md

This file is a thin shim: all cross-tool repo guidance lives in `AGENTS.md`,
imported above. Keep only Claude-Code-specific notes here.

## Notes

- Use plan mode before broad, repo-wide changes.
- After non-trivial changes, run `pnpm -r run typecheck` and `pnpm test`.
- Demo mode (`pnpm dev`, no secrets) is the fastest way to exercise the UI.
