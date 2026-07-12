# Third-party notices

RepoWrangler is licensed under the Apache License 2.0 (see `LICENSE`).
This file records upstream projects whose work influenced RepoWrangler and the
license obligations that apply. The machine-readable source of truth is
`credits.yaml`; the in-product page at `/credits` is generated from the same
data.

## Upstream projects

### GitactionBoard

- Upstream: <https://github.com/otto-de/gitactionboard>
- License: Apache-2.0
- Copyright: OTTO and contributors
- Reviewed commit: `960222d210b21f7423cff5032838e5da3c6cfc77`
- Relationship: **conceptual inspiration only** — workflow reliability metric
  concepts and build-monitor presentation ideas. No source code has been
  copied into RepoWrangler.

### Git Pull Request Dashboard

- Upstream: <https://github.com/AKharytonchyk/git-pull-request-dashboard>
- License: MIT
- Copyright: Artsiom Kharytonchyk
- Reviewed commit: `6aa443f2b1562db7bbd5286a8b52292539093d42`
- Relationship: **conceptual inspiration only** — pull request normalization
  and multi-organization aggregation concepts. No source code has been copied
  into RepoWrangler.

## Obligations when code is copied

If a future change copies or substantially adapts source from either project
(or any other), the contributor must:

1. Preserve the upstream copyright and license notice in the copied file.
2. Add the exact upstream file path and commit SHA in a source comment.
3. Add the file to `copied_files` in `credits.yaml`.
4. Add the full license text under `LICENSES/` if not already present.
5. Update this file and `CREDITS.md`.

## Runtime dependencies

Direct dependencies (Hono, React, TanStack Query, React Router, Zod, and the
Cloudflare tooling) are used under their published licenses via the package
registry and are not redistributed in source form in this repository.
Dependency license reports are part of the release process (SPIKE-013).
