/**
 * Design tokens shared across RepoWrangler surfaces. Plain data (no framework),
 * so the SPA, docs, and any future shell stay visually consistent. Values are
 * CSS custom-property-friendly strings; the SPA maps `tone` → these.
 */

export type SemanticTone = 'ok' | 'muted' | 'warn' | 'error' | 'info';

/** Attention severity used by the Command Center ranking. */
export type AttentionLevel = 'critical' | 'high' | 'medium' | 'low' | 'none';

export const TONE_COLOR: Record<SemanticTone, string> = {
  ok: '#1a7f37',
  muted: '#57606a',
  warn: '#9a6700',
  error: '#cf222e',
  info: '#0969da',
};

export const ATTENTION_TONE: Record<AttentionLevel, SemanticTone> = {
  critical: 'error',
  high: 'error',
  medium: 'warn',
  low: 'info',
  none: 'ok',
};

export const ATTENTION_LABEL: Record<AttentionLevel, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  none: 'Healthy',
};

/** Rank for sorting an attention-first list (higher = more urgent). */
export const ATTENTION_RANK: Record<AttentionLevel, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  none: 0,
};
