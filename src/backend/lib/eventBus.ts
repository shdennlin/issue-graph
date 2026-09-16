// Tiny in-process pub/sub used to push events from background tasks (file
// watcher, future schedulers) to long-lived SSE connections.
//
// Single-process by design — issue-graph runs as one Hono process per
// instance, so a Node EventEmitter-equivalent is enough; no Redis / queue.

type Listener = (event: BusEvent) => void

export const BUS_EVENT = {
  DESIGNDOC_CHANGED: 'designdoc-changed',
  DEFAULT_WORKSPACE_CHANGED: 'default-workspace-changed',
  /** A Linear webhook triggered a sync that completed. Clients refetch. */
  ISSUES_CHANGED: 'issues-changed',
} as const
export type BusEventType = (typeof BUS_EVENT)[keyof typeof BUS_EVENT]

export interface BusEvent {
  /** Event type — clients can filter by this. */
  type: BusEventType
  /** Optional payload (kept small; clients typically refetch). */
  data?: Record<string, unknown>
}

const listeners = new Set<Listener>()

export function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function publish(event: BusEvent): void {
  // Snapshot before iterating so a listener that unsubscribes mid-flight
  // doesn't perturb the iteration.
  for (const listener of [...listeners]) {
    try {
      listener(event)
    } catch {
      // Listener errors must not poison the bus — swallow and continue.
    }
  }
}

/** Number of active listeners, exposed for diagnostics / tests. */
export function listenerCount(): number {
  return listeners.size
}
