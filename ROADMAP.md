# Roadmap

The authoritative phased roadmap lives in the
[solution design pack](docs/design/RepoWrangler-Solution-Design.md). Summary:

- **Phase 0 — Foundation and governance** ✅ scaffolded: public repo, license
  and credits machinery, CI, demo mode without secrets.
- **Phase 1 — GitHub estate MVP** 🚧 in progress: GitHub App connection,
  automatic discovery, D1 inventory, Command Center, workflow/PR state,
  connection health. Core engine implemented; needs the research-spike
  validation pass (Worker CPU benchmark, permission matrix) and live-estate
  testing.
- **Phase 2 — Branch and change intelligence:** deeper comparisons, saved
  views, exclusion policy administration.
- **Phase 3 — Governance, security, budgets, usage:** protection/ruleset
  checks, security alert reconciliation, budgets and enhanced billing where
  authorized, exports.
- **Phase 4 — GitLab provider:** groups/subgroups discovery, pipelines, MRs,
  unified estate views.
- **Phase 5 — Notifications and controlled operations:** outbound webhooks,
  Teams/Slack/Discord, acknowledgements, optional separate write path.
- **Phase 6 — Ecosystem:** Azure DevOps/Bitbucket, MCP server, self-hosted
  Node/PostgreSQL target, multi-user views.
