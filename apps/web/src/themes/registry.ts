/**
 * Theme registry — Hugo/Jekyll-style drop-in themes.
 *
 * Every `*.css` file in this directory is bundled automatically via Vite's glob
 * import, and each one that declares a `[data-theme='<id>']` block becomes a
 * selectable theme. To ADD a theme: drop `src/themes/<your-id>.css` defining
 * `[data-theme='<your-id>'] { --rw-*: … }` — it appears in the switcher on the
 * next build with a title-cased label. Add an entry to THEME_MANIFEST below only
 * to refine its label or light/dark scheme.
 *
 * No core code changes are needed to theme the product — that is the whole point.
 */

// Side effect: bundle every theme stylesheet in this directory.
const modules = import.meta.glob('./*.css', { eager: true });

export type ThemeScheme = 'light' | 'dark';

export interface ThemeMeta {
  id: string;
  label: string;
  scheme: ThemeScheme;
}

/** Optional refinements for built-in themes; drop-ins not listed still work. */
const THEME_MANIFEST: Record<string, { label: string; scheme: ThemeScheme }> = {
  light: { label: 'Light', scheme: 'light' },
  dark: { label: 'Dark', scheme: 'dark' },
  midnight: { label: 'Midnight', scheme: 'dark' },
  slate: { label: 'Slate', scheme: 'dark' },
  sandstone: { label: 'Sandstone', scheme: 'light' },
  'high-contrast': { label: 'High Contrast', scheme: 'dark' },
};

function idFromPath(path: string): string {
  return path.replace(/^.*\//, '').replace(/\.css$/, '');
}

function titleCase(id: string): string {
  return id.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export const AVAILABLE_THEMES: ThemeMeta[] = [
  ...Object.keys(modules)
    .map(idFromPath)
    .sort()
    .map((id) => ({
      id,
      label: THEME_MANIFEST[id]?.label ?? titleCase(id),
      scheme: THEME_MANIFEST[id]?.scheme ?? 'light',
    })),
  // The Custom theme has no stylesheet — it is applied at runtime from a
  // user-defined palette (see custom.ts + the Theme Studio).
  { id: 'custom', label: 'Custom…', scheme: 'light' },
];

export function isKnownTheme(id: string | null | undefined): id is string {
  return !!id && AVAILABLE_THEMES.some((t) => t.id === id);
}

/**
 * Resolve the initial theme: a valid saved choice wins, then the deployer's
 * build-time VITE_DEFAULT_THEME, then the OS light/dark preference.
 */
export function resolveInitialTheme(saved: string | null): string {
  if (isKnownTheme(saved)) return saved;
  const configured = import.meta.env.VITE_DEFAULT_THEME;
  if (isKnownTheme(configured)) return configured;
  const prefersDark =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  return prefersDark ? 'dark' : 'light';
}
