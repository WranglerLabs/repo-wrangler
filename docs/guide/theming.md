# Theming

RepoWrangler themes work like Hugo/Jekyll themes: a theme is a **single CSS file**
you drop in, and it appears in the UI theme switcher automatically. No component
or build-config changes are needed. See [ADR-012](../adr/ADR-012-theming.md) for
the rationale.

## Built-in themes

`light` (default), `dark`, `midnight`, `slate`, `sandstone`, `high-contrast`.

Users pick a theme from the switcher in the sidebar; the choice is saved per
browser. Deployers can set the first-visit default with the build-time env var
`VITE_DEFAULT_THEME=<id>` (empty follows the OS light/dark preference).

## Customize colors live — Theme Studio

You don't have to edit a file to change colors. Open **Customize colors →** under
the theme switcher (route `/theme`) to open the **Theme Studio**:

- Pick any token color with a color picker and see it applied **live**.
- Your palette is saved in the browser as the **Custom** theme (persists across
  visits, no rebuild).
- **Start from current theme** seeds the editor from whatever theme you're on;
  **Reset to defaults** returns to the light palette.
- **Export** downloads (or copies) a ready-to-commit `themes/<id>.css`. Drop that
  file into `apps/web/src/themes/` and it becomes a permanent, shareable theme for
  every deployment — see below.

So there are two levels: **per-browser color tweaking** (Theme Studio, no build)
and **permanent shared themes** (a committed CSS file).

## How a theme works

Every color, surface, and radius in the app is a CSS custom property (`--rw-*`).
Components only read them via `var(--rw-…)`, so a theme is just a set of token
values. The `light` theme also defines `:root`, so tokens exist before any theme
is selected.

## Add your own theme

1. Create `apps/web/src/themes/<your-id>.css`:

   ```css
   /* Theme: Ocean */
   [data-theme='ocean'] {
     --rw-green: #0e7490;        /* primary accent (sidebar, buttons) */
     --rw-green-strong: #0b5766;
     --rw-blue: #38bdf8;
     --rw-gold: #fbbf24;
     --rw-bg: #f0f9ff;
     --rw-surface: #ffffff;
     --rw-surface-2: #e0f2fe;
     --rw-text: #0c1a24;
     --rw-text-muted: #52707e;
     --rw-border: #c9e6f2;
     --rw-critical: #b3261e;
     --rw-high: #c4622d;
     --rw-medium: #b08a1e;
     --rw-low: #3d6f9e;
     --rw-healthy: #2f7d4f;
     --rw-unknown: #77807a;
     --rw-radius: 8px;
     color-scheme: light;   /* light | dark — sets native control colors */
   }
   ```

2. That's it — rebuild (`pnpm --filter @repo-wrangler/web build`) and **Ocean**
   shows up in the switcher (label is title-cased from the filename).

3. *(Optional)* refine the label or scheme by adding one line to
   `THEME_MANIFEST` in `apps/web/src/themes/registry.ts`:

   ```ts
   ocean: { label: 'Ocean Breeze', scheme: 'light' },
   ```

## Token reference

| Token | Used for |
|---|---|
| `--rw-green` / `--rw-green-strong` | Primary accent — sidebar, buttons, active nav |
| `--rw-blue` | Links and info |
| `--rw-gold` | Highlights, active tab underline, demo banner |
| `--rw-bg` / `--rw-surface` / `--rw-surface-2` | Page, card, and hover backgrounds |
| `--rw-text` / `--rw-text-muted` | Body and secondary text |
| `--rw-border` | Card, table, and input borders |
| `--rw-critical` / `--rw-high` / `--rw-medium` / `--rw-low` / `--rw-healthy` / `--rw-unknown` | Attention/severity badges |
| `--rw-radius` | Corner rounding |
| `color-scheme` | `light` or `dark` — themes native form controls and scrollbars |

## Making a whole custom brand

For a full rebrand, copy `light.css` to `brand.css`, change the token values to
your palette, set `VITE_DEFAULT_THEME=brand`, and (optionally) remove the built-in
themes you don't want by deleting their files — the switcher only lists what's in
`src/themes/`.
