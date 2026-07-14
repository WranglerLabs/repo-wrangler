/**
 * Shared sizing for contained-scroll, virtualized list panels (B10). Every
 * estate-wide list that can grow large caps its own scroll height instead of
 * letting the whole page grow unbounded — the pattern first established on
 * the Repositories view, now shared so every list panel stays visually
 * consistent and `useVirtualWindow` is driven by the same row/viewport math.
 */
export const ROW_HEIGHT = 48;
export const VIEWPORT_HEIGHT = 600;
export const VIRTUALIZE_ABOVE = 50;
