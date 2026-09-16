// Presenting agent-session presence on a card.
//
// Pure, because vitest's include glob is `src/**/*.{test,spec}.ts` and no JSX
// in this repo is testable. Same split as lib/lifecycle.ts.
//
// The server has already applied the TTL, so anything reaching here is a
// session believed to be alive. This module only decides how to say so.

import type { AgentSessionDTO } from '@shared/types'

export type SessionPresence =
  | { kind: 'none' }
  /** At least one session is working. `lastSeen` is its newest heartbeat. */
  | { kind: 'active'; lastSeen: number; count: number; phase: string | null }
  /** Every session on this issue has ended its turn and is waiting on a human. */
  | { kind: 'idle'; lastSeen: number; count: number; phase: string | null }

export function indexSessionsByIssue(
  sessions: AgentSessionDTO[] | undefined,
): Map<string, AgentSessionDTO[]> {
  const map = new Map<string, AgentSessionDTO[]>()
  for (const s of sessions ?? []) {
    if (!s.identifier) continue
    const list = map.get(s.identifier)
    if (list) list.push(s)
    else map.set(s.identifier, [s])
  }
  return map
}

/**
 * Collapse the sessions on one issue into a single presence.
 *
 * `active` wins over `idle` when both are present: if anything is still moving,
 * the issue is being worked on, and showing "waiting for you" while a sibling
 * session edits files would send the reader to the wrong terminal.
 *
 * The reported `lastSeen` and `phase` come from the most recent heartbeat among
 * the sessions that decided the kind, not from the group as a whole — the
 * newest active session is the one whose progress is worth reading.
 */
export function sessionPresence(sessions: AgentSessionDTO[] | undefined): SessionPresence {
  if (!sessions || sessions.length === 0) return { kind: 'none' }
  const active = sessions.filter((s) => s.status === 'active')
  const group = active.length > 0 ? active : sessions
  const kind = active.length > 0 ? 'active' : 'idle'

  let newest = group[0]
  if (!newest) return { kind: 'none' }
  for (const s of group) if (s.lastSeen > newest.lastSeen) newest = s

  // A timestamp rather than an elapsed duration, so the caller can hand it
  // straight to compactAge — which already clamps, covering the case where a
  // laptop's clock runs ahead of the server that stamped the row.
  return { kind, lastSeen: newest.lastSeen, count: group.length, phase: newest.phase }
}
