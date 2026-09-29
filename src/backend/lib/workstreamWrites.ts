// Which requests change what the workstream board draws.
//
// Pure, and apart from the middleware that uses it, so the list can be tested:
// the middleware sits in index.ts, which reaches `bun:sqlite`.
//
// The board had no way to hear about these. The page's 30s poll swaps data in
// only when `fetchedAt` — the last LINEAR sync — has moved, and the SSE stream
// carried design-doc, webhook and default-workspace events only. So a stage
// moved or a note written through the MCP stayed invisible on an open page
// until something unrelated made it refetch.
//
// By PREFIX, not by route, on purpose: a route added under one of these later
// is covered without anyone remembering this file. The cost is the occasional
// event for a write the board does not draw, which costs one silent refetch.

const PREFIXES = ['/api/batches', '/api/lifecycle', '/api/fields', '/api/agent-sessions'] as const

const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export function isWorkstreamWrite(method: string, path: string, status: number): boolean {
  if (!WRITES.has(method.toUpperCase())) return false
  // A rejected write changed nothing, and a 401 from a stranger probing the
  // session endpoint must not become a way to make every open tab refetch.
  if (status < 200 || status >= 300) return false
  return PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))
}
