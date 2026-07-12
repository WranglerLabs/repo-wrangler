# Roadmap

The authoritative phased roadmap lives in the
[solution design pack](docs/design/RepoWrangler-Solution-Design.md). Summary:

- **Phase 0 — Foundation and governance** ✅ done: public repo, license and
  credits machinery, CI + CodeQL, issue/PR templates, runbooks, demo mode
  without secrets.
- **Phase 1 — GitHub estate MVP** ✅ done: GitHub App connection, automatic
  discovery, D1 inventory, Command Center, workflow/PR state, connection
  health. Spike outcomes recorded in `docs/research/`.
- **Phase 2 — Branch and change intelligence** ✅ done: estate Branches and
  Change Requests pages, FR-005 comparison semantics, exclusion patterns.
- **Phase 3 — Governance, security, budgets, usage** ✅ done: protection and
  hygiene checks, security alert reconciliation, budget sync, estate Security
  and Budgets & Usage pages, capability-state UX, JSON export. Enhanced
  billing usage ingestion still needs validation against an enhanced-billing
  organization.
- **Phase 4 — GitLab provider** ✅ done: groups/subgroups discovery,
  pipelines, MRs, branch comparison, optional webhooks, unified estate views.
- **Phase 5 — Notifications and controlled operations** 🚧 partial: outbound
  escalation webhook shipped. Remaining: Teams/Slack/Discord connectors,
  acknowledgements/quiet hours, optional rerun action via a separate write
  path, PWA shell.
- **Phase 6 — Ecosystem:** Azure DevOps/Bitbucket, MCP server, self-hosted
  Node/PostgreSQL target, multi-user views.
