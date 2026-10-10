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
  | { kind: 'waiting'; lastSeen: number; count: number; phase: string | null }
  /** At least one session is stopped on a permission prompt. Nothing is running
   *  behind it, so this outranks both of the others — it is the only state that
   *  should pull someone over. */
  | { kind: 'blocked'; lastSeen: number; count: number; phase: string | null }

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

/** Sessions by the workstream they last wrote to. Unclaimed ones are left
 *  out — they are placed by issue instead (see stageRender `claimedSessions`). */
export function indexSessionsByWorkstream(
  sessions: AgentSessionDTO[] | undefined,
): Map<number, AgentSessionDTO[]> {
  const map = new Map<number, AgentSessionDTO[]>()
  for (const s of sessions ?? []) {
    if (s.workstreamId === null) continue
    const list = map.get(s.workstreamId)
    if (list) list.push(s)
    else map.set(s.workstreamId, [s])
  }
  return map
}

/** What a workstream's header says about one session working on it. */
export interface HeaderSession {
  /** Full id — what `claude --resume` takes, so it is what a click copies. */
  id: string
  /** Enough of the id to tell two sessions apart at a glance; a UUID's first
   *  block is unique in practice across the handful alive at once. */
  shortId: string
  name: string
  status: AgentSessionDTO['status']
}

/**
 * The sessions to name in a workstream's header: the ones that CLAIMED it —
 * wrote to it — newest heartbeat first. Only those: a session placed by its
 * branch's issue is a guess about the issue, and the header speaks for the
 * workstream.
 */
export function headerSessions(claimed: AgentSessionDTO[] | undefined): HeaderSession[] {
  return [...(claimed ?? [])]
    .sort((a, b) => b.lastSeen - a.lastSeen)
    .map((s) => ({ id: s.sessionId, shortId: s.sessionId.slice(0, 8), name: s.label, status: s.status }))
}

/**
 * Collapse the sessions on one issue into a single presence.
 *
 * Precedence is blocked > active > waiting, and the order is not arbitrary.
 * `blocked` first because something has stopped and will not restart until a
 * person acts — that outranks progress elsewhere. Then `active`: if anything is
 * still moving, the issue is being worked on, and showing "waiting for you"
 * while a sibling session edits files would send the reader to the wrong
 * terminal.
 *
 * The reported `lastSeen` and `phase` come from the most recent heartbeat among
 * the sessions that decided the kind, not from the group as a whole — the
 * newest active session is the one whose progress is worth reading.
 */
export function sessionPresence(sessions: AgentSessionDTO[] | undefined): SessionPresence {
  if (!sessions || sessions.length === 0) return { kind: 'none' }
  const blocked = sessions.filter((s) => s.status === 'blocked')
  const active = sessions.filter((s) => s.status === 'active')
  const group = blocked.length > 0 ? blocked : active.length > 0 ? active : sessions
  const kind: 'blocked' | 'active' | 'waiting' =
    blocked.length > 0 ? 'blocked' : active.length > 0 ? 'active' : 'waiting'

  let newest = group[0]
  if (!newest) return { kind: 'none' }
  for (const s of group) if (s.lastSeen > newest.lastSeen) newest = s

  // A timestamp rather than an elapsed duration, so the caller can hand it
  // straight to compactAge — which already clamps, covering the case where a
  // laptop's clock runs ahead of the server that stamped the row.
  return { kind, lastSeen: newest.lastSeen, count: group.length, phase: newest.phase }
}
