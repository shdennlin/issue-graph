// Helper for views that group issues into containers (mix, project).
// Without column packing a container with many issues becomes an
// unusably tall narrow column — the user has to scroll inside the
// already-zoomable canvas. Wrap into 2 or 3 columns once the count
// crosses readable thresholds.

export interface PackInput {
  id: string
  h: number
}

export interface PackedItem {
  id: string
  /** Column index (0-based). */
  col: number
  /** Y offset within the column. */
  y: number
  h: number
}

/**
 * Pick a column count: up to `maxCols` issues per row, wrap when the row
 * is full. If a container has fewer issues than `maxCols` it just uses
 * that many columns so the box isn't padded with empty slots.
 *
 * Combined with row-major packing in `packIntoColumns`, this gives a
 * predictable flat-and-wide layout where issue order reads naturally
 * left-to-right, top-to-bottom. `maxCols` is user-tunable (Settings →
 * Display → Issues per row) so people on big screens can pack more
 * cards per row.
 */
export const DEFAULT_MAX_COLS = 4
export function chooseColumnCount(itemCount: number, maxCols: number = DEFAULT_MAX_COLS): number {
  if (itemCount <= 0) return 1
  return Math.min(maxCols, itemCount)
}

/**
 * Row-major packing: item `i` lands at column `i % cols`, row `floor(i / cols)`.
 * Each row's vertical span is the tallest item in that row, so cards in the
 * same row top-align with a ragged bottom (standard CSS-grid behavior).
 *
 * Why row-major: the visual order matches the issue order (item 0 top-left,
 * item 1 to its right, wraps to next row when the row is full). The previous
 * "shortest column first" packing produced shorter containers when card
 * heights varied a lot, but the reading order skipped around — a less
 * intuitive default. Toggle is planned to expose the old behavior as an
 * option.
 *
 * Returns per-item placement plus the resulting total content height so the
 * caller can size the container.
 */
export function packIntoColumns(
  items: PackInput[],
  cols: number,
  gapY: number,
): { placed: PackedItem[]; maxColumnHeight: number } {
  // Pass 1: compute the height of each row (max height of items in that row).
  const rowHeights: number[] = []
  for (let i = 0; i < items.length; i++) {
    const row = Math.floor(i / cols)
    const h = items[i]!.h
    rowHeights[row] = Math.max(rowHeights[row] ?? 0, h)
  }

  // Pass 2: compute each row's y offset by accumulating prior row heights.
  const rowYs: number[] = []
  let cum = 0
  for (let r = 0; r < rowHeights.length; r++) {
    rowYs[r] = cum
    cum += rowHeights[r]!
    if (r < rowHeights.length - 1) cum += gapY
  }

  // Pass 3: place each item at its (col, row) slot, top-aligned within the row.
  const placed: PackedItem[] = items.map((item, i) => ({
    id: item.id,
    col: i % cols,
    y: rowYs[Math.floor(i / cols)]!,
    h: item.h,
  }))

  // Total content height is the cumulative span; the field name stays
  // `maxColumnHeight` for back-compat with callers that compute container
  // height from it (the value is now total-content-height for row-major,
  // which is the equivalent vertical size).
  return { placed, maxColumnHeight: cum }
}
