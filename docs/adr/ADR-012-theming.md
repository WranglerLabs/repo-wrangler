# ADR-012 — Drop-in theming (Hugo/Jekyll-style)

- **Status:** Accepted
- **Date:** 2026-07-12
- **Relates to:** ADR-004 (provider-neutral domain), ADR-011 (host-agnostic frontend)

## Context

Deployers want to change RepoWrangler's look — brand colors, a darker palette, a
high-contrast accessible variant — **without forking the app or editing
components**. Static site generators like Hugo and Jekyll solve this with
*themes*: a self-contained set of styling you drop in and select by name.

The SPA was already built entirely on CSS custom properties (`--rw-*`): every
color, radius, and surface is a token, and components only ever read them via
`var(--rw-…)`. That means the visual identity is fully separable from the markup
— the ideal substrate for a theme system.

## Decision

A **theme is a single CSS file** under `apps/web/src/themes/<id>.css` that
declares the token set for a `[data-theme='<id>']` selector (the `light` theme
additionally defines `:root` so tokens exist before any theme is applied).

- **Auto-discovery (the Hugo-like part):** `themes/registry.ts` bundles every
  `themes/*.css` via Vite's `import.meta.glob(..., { eager: true })` and derives
  the selectable theme list from the filenames. **Dropping a new
  `themes/foo.css` in makes "Foo" appear in the switcher on the next build — no
  code change.** An optional `THEME_MANIFEST` entry only refines a theme's label
  or light/dark scheme.
- **Selection precedence:** a valid user choice in `localStorage` wins, else the
  deployer's build-time `VITE_DEFAULT_THEME`, else the OS `prefers-color-scheme`.
- **Switching:** setting `document.documentElement.dataset.theme` swaps the whole
  palette instantly; the choice persists per browser. A `<select>` in the sidebar
  lists all discovered themes.
- **Ships with:** `light` (default), `dark`, `midnight`, `slate`, `sandstone`,
  `high-contrast`.

Theming is **frontend-only** and requires no server state, no D1, and no secrets,
so it works identically in demo mode and in every deployment topology (ADR-011).

## Consequences

**Positive**
- Rebranding or adding a palette is one CSS file — the exact "drop in a theme"
  ergonomics the request asked for, and safe for non-developers.
- The token discipline that already existed is now the public extension point;
  components never need to know a theme exists.
- A `high-contrast` theme gives an accessibility path out of the box.

**Negative / limits**
- A theme can only restyle what a token controls. New tokens (e.g. a new accent
  role) require adding the `var(--rw-…)` reference in the structural CSS once;
  after that, themes can set it. This keeps the token vocabulary intentional.
- `VITE_DEFAULT_THEME` is baked at build time (a deploy-time choice); users
  override it live, so this only sets the first-visit default.

**Neutral**
- Theme CSS is bundled, not fetched at runtime, so themes cannot be added to a
  *built* deployment without a rebuild — consistent with the static-bundle model.
