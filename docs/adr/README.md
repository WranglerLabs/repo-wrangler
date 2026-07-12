# Architectural decision records

ADR-001 through ADR-010 were authored as part of the solution design pack and
live in [docs/design/RepoWrangler-Solution-Design.md](../design/RepoWrangler-Solution-Design.md#architectural-decision-records):

1. ADR-001 — Cloudflare Workers as the full-stack runtime
2. ADR-002 — Public product code, optional private ops notes
3. ADR-003 — Read-only GitHub App
4. ADR-004 — Provider-neutral domain with adapters
5. ADR-005 — Cloudflare D1 as the initial primary store
6. ADR-006 — Webhooks + checkpointed reconciliation
7. ADR-007 — Apache-2.0 license
8. ADR-008 — No provider write actions in the MVP
9. ADR-009 — Queues optional until benchmarked
10. ADR-010 — Single-tenant first

New ADRs get their own numbered Markdown file in this directory
(`ADR-011-<slug>.md` onward) using the same Context / Decision / Consequences
format.
