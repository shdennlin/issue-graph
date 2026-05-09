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
 * Pick a column count based on issue count. Tuned so small containers
 * stay vertical (preserves the at-a-glance "scan top-down" reading
 * model that Linear's own UI uses), and large ones widen instead of
 * scrolling forever.
 *
 * Thresholds:
 *   ≤ 8   → 1 column   (typical project size, stays scannable)
 *   9-20  → 2 columns  (medium project, still fits a screen width)
 *   > 20  → 3 columns  (cap; 4+ columns make the container too wide
 *                       to read without panning)
 */
export function chooseColumnCount(itemCount: number): number {
  if (itemCount <= 8) return 1
  if (itemCount <= 20) return 2
  return 3
}

/**
 * Greedy column packing: place each issue in the currently-shortest
 * column. Preserves input order within each column (stable when ties).
 *
 * Returns per-item placement plus the resulting tallest-column height
 * so the caller can size the container.
 */
export function packIntoColumns(
  items: PackInput[],
  cols: number,
  gapY: number,
): { placed: PackedItem[]; maxColumnHeight: number } {
  const colHeights = new Array<number>(cols).fill(0)
  // Track whether each column already has at least one item, so we know
  // whether to add a top gap before the next item.
  const colHasItem = new Array<boolean>(cols).fill(false)
  const placed: PackedItem[] = []

  for (const item of items) {
    let minIdx = 0
    for (let i = 1; i < cols; i++) {
      if (colHeights[i]! < colHeights[minIdx]!) minIdx = i
    }
    // Add a gap above this item iff the column already has something
    // — avoids a leading gap at the top of each column.
    const y = colHeights[minIdx]! + (colHasItem[minIdx] ? gapY : 0)
    placed.push({ id: item.id, col: minIdx, y, h: item.h })
    colHeights[minIdx] = y + item.h
    colHasItem[minIdx] = true
  }

  const maxColumnHeight = Math.max(0, ...colHeights)
  return { placed, maxColumnHeight }
}
