import { useState, type UIEvent } from 'react';

export interface VirtualWindow {
  start: number;
  end: number;
  padTop: number;
  padBottom: number;
  onScroll: (event: UIEvent<HTMLElement>) => void;
}

/**
 * Minimal row windowing for large tables (NFR-002): render only the rows near
 * the viewport, with spacer padding preserving scroll height. Fixed row height.
 */
export function useVirtualWindow(
  total: number,
  rowHeight: number,
  viewportHeight: number,
  overscan = 10,
): VirtualWindow {
  const [scrollTop, setScrollTop] = useState(0);
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const visibleCount = Math.ceil(viewportHeight / rowHeight) + overscan * 2;
  const end = Math.min(total, start + visibleCount);
  return {
    start,
    end,
    padTop: start * rowHeight,
    padBottom: Math.max(0, (total - end) * rowHeight),
    onScroll: (event) => setScrollTop(event.currentTarget.scrollTop),
  };
}
