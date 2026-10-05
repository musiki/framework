/**
 * Pure helpers for the trace rail layout. The rail is a vertically scrolling
 * list with one in-flow block per paragraph (document order); these helpers
 * decide how the rail follows the paragraph the author is working in.
 */

/**
 * Smallest scrollTop change that makes a block visible inside a scroll
 * container, keeping `stickyOffset` px at the top free for a sticky header.
 * A block taller than the viewport is aligned to its top so its header is shown.
 * All coordinates are relative to the scroll container's content box.
 */
export function scrollTopToReveal(opts: {
  scrollTop: number;
  viewHeight: number;
  blockTop: number;
  blockHeight: number;
  stickyOffset?: number;
}): number {
  const { scrollTop, viewHeight, blockTop, blockHeight } = opts;
  const offset = opts.stickyOffset ?? 0;
  const visibleTop = scrollTop + offset;
  const visibleBottom = scrollTop + viewHeight;
  if (blockTop < visibleTop) return Math.max(0, blockTop - offset);
  if (blockTop + blockHeight > visibleBottom) {
    if (blockHeight + offset >= viewHeight) return Math.max(0, blockTop - offset);
    return Math.max(0, blockTop + blockHeight - viewHeight);
  }
  return scrollTop;
}
