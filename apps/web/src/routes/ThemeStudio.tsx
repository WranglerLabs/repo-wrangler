import { useState } from 'react';
import { TOKENS, defaultPalette, type Palette } from '../themes/tokens';
import {
  CUSTOM_THEME_ID,
  applyCustomPalette,
  exportThemeCss,
  loadCustomPalette,
  readActivePalette,
  saveCustomPalette,
} from '../themes/custom';

const GROUPS = ['Brand', 'Surfaces', 'Text', 'Severity', 'Shape'] as const;
const HEX6 = /^#[0-9a-f]{6}$/i;

function activateCustom(palette: Palette): void {
  saveCustomPalette(palette);
  document.documentElement.dataset.theme = CUSTOM_THEME_ID;
  localStorage.setItem('rw-theme', CUSTOM_THEME_ID);
  applyCustomPalette(palette);
}

export function ThemeStudio() {
  const [palette, setPalette] = useState<Palette>(() => loadCustomPalette());
  const [name, setName] = useState('my-theme');

  function seed(next: Palette): void {
    setPalette(next);
    activateCustom(next);
  }

  function update(key: string, value: string): void {
    seed({ ...palette, [key]: value });
  }

  const css = exportThemeCss(name, palette);

  function download(): void {
    const blob = new Blob([css], { type: 'text/css' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name || 'custom'}.css`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <h1 className="page-title">Theme Studio</h1>
      <p className="page-subtitle">
        Pick colors and see them applied live. Your palette is saved in this browser (the
        <strong> Custom </strong>theme); export it as a theme file to make it permanent for everyone.
      </p>

      <div className="toolbar">
        <button className="ghost" onClick={() => seed(readActivePalette())}>
          Start from current theme
        </button>
        <button className="ghost" onClick={() => seed(defaultPalette())}>
          Reset to defaults
        </button>
      </div>

      {GROUPS.map((group) => (
        <div className="panel" key={group}>
          <h2>{group}</h2>
          <div className="token-grid">
            {TOKENS.filter((t) => t.group === group).map((t) => {
              const value = palette[t.key] ?? t.default;
              return (
                <label key={t.key} className="token-row">
                  <span>{t.label}</span>
                  {t.type === 'color' ? (
                    <input
                      type="color"
                      value={HEX6.test(value) ? value : t.default}
                      onChange={(e) => update(t.key, e.target.value)}
                    />
                  ) : (
                    <input
                      type="text"
                      value={value}
                      onChange={(e) => update(t.key, e.target.value)}
                      style={{ width: 90 }}
                    />
                  )}
                </label>
              );
            })}
          </div>
        </div>
      ))}

      <div className="panel">
        <h2>Export as a theme file</h2>
        <div className="toolbar">
          <input
            type="search"
            value={name}
            aria-label="Theme id"
            placeholder="theme id"
            onChange={(e) => setName(e.target.value)}
          />
          <button onClick={download}>Download {name || 'custom'}.css</button>
          <button className="ghost" onClick={() => void navigator.clipboard?.writeText(css)}>
            Copy CSS
          </button>
        </div>
        <pre
          className="mono"
          style={{
            whiteSpace: 'pre-wrap',
            background: 'var(--rw-surface-2)',
            padding: 12,
            borderRadius: 'var(--rw-radius)',
          }}
        >
          {css}
        </pre>
        <p className="muted">
          Drop this into <code>apps/web/src/themes/{name || 'custom'}.css</code>, rebuild, and it
          appears in the theme switcher for everyone (see docs/guide/theming.md).
        </p>
      </div>
    </div>
  );
}
