// Resolve a node's absolute canvas coordinates by walking its parent chain.
//
// React Flow stores a child node's `position` as relative to its parent's
// transform. With nested parents (e.g. milestone view's issue → milestone →
// projectBackdrop), a single-level lookup misses ancestor offsets and lands
// the camera at the wrong spot.

export interface NodeLike {
  position: { x: number; y: number }
  parentNode?: string | undefined
}

export function resolveAbsolutePosition(
  node: NodeLike,
  lookup: (id: string) => NodeLike | undefined,
): { x: number; y: number } {
  let x = node.position.x
  let y = node.position.y
  let parentId = node.parentNode
  // `seen` guards against malformed cycles in node data — without it a bad
  // graph would freeze the UI in an infinite loop.
  const seen = new Set<string>()
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId)
    const parent = lookup(parentId)
    if (!parent) break
    x += parent.position.x
    y += parent.position.y
    parentId = parent.parentNode
  }
  return { x, y }
}
