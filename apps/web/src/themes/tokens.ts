/**
 * The editable design-token roles, used by the Theme Studio (custom colors) and
 * by the CSS export. Each maps a friendly label to a `--rw-*` custom property.
 * Defaults are the Light theme values, used as a fallback and as the export base.
 */
export interface TokenRole {
  key: string; // stable key used in the saved custom palette
  var: string; // the CSS custom property it drives
  label: string;
  group: 'Brand' | 'Surfaces' | 'Text' | 'Severity' | 'Shape';
  type: 'color' | 'text';
  default: string;
}

export const TOKENS: TokenRole[] = [
  { key: 'accent', var: '--rw-green', label: 'Primary accent', group: 'Brand', type: 'color', default: '#1f4d3a' },
  { key: 'accentStrong', var: '--rw-green-strong', label: 'Accent (strong)', group: 'Brand', type: 'color', default: '#163a2c' },
  { key: 'link', var: '--rw-blue', label: 'Links / info', group: 'Brand', type: 'color', default: '#2e7cd6' },
  { key: 'highlight', var: '--rw-gold', label: 'Highlight', group: 'Brand', type: 'color', default: '#d9a441' },
  { key: 'bg', var: '--rw-bg', label: 'Page background', group: 'Surfaces', type: 'color', default: '#f7f3ea' },
  { key: 'surface', var: '--rw-surface', label: 'Card surface', group: 'Surfaces', type: 'color', default: '#ffffff' },
  { key: 'surface2', var: '--rw-surface-2', label: 'Hover / raised', group: 'Surfaces', type: 'color', default: '#efe9dc' },
  { key: 'border', var: '--rw-border', label: 'Border', group: 'Surfaces', type: 'color', default: '#ddd6c6' },
  { key: 'text', var: '--rw-text', label: 'Text', group: 'Text', type: 'color', default: '#1d221f' },
  { key: 'textMuted', var: '--rw-text-muted', label: 'Muted text', group: 'Text', type: 'color', default: '#5c645e' },
  { key: 'critical', var: '--rw-critical', label: 'Critical', group: 'Severity', type: 'color', default: '#b3261e' },
  { key: 'high', var: '--rw-high', label: 'High', group: 'Severity', type: 'color', default: '#c4622d' },
  { key: 'medium', var: '--rw-medium', label: 'Medium', group: 'Severity', type: 'color', default: '#b08a1e' },
  { key: 'low', var: '--rw-low', label: 'Low', group: 'Severity', type: 'color', default: '#3d6f9e' },
  { key: 'healthy', var: '--rw-healthy', label: 'Healthy', group: 'Severity', type: 'color', default: '#2f7d4f' },
  { key: 'unknown', var: '--rw-unknown', label: 'Unknown', group: 'Severity', type: 'color', default: '#77807a' },
  { key: 'radius', var: '--rw-radius', label: 'Corner radius (px)', group: 'Shape', type: 'text', default: '8px' },
];

export type Palette = Record<string, string>;

export function defaultPalette(): Palette {
  const p: Palette = {};
  for (const t of TOKENS) p[t.key] = t.default;
  return p;
}
