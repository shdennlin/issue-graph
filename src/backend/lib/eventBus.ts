// Tiny in-process pub/sub used to push events from background tasks (file
// watcher, future schedulers) to long-lived SSE connections.
//
// Single-process by design — issue-graph runs as one Hono process per
// instance, so a Node EventEmitter-equivalent is enough; no Redis / queue.

type Listener = (event: BusEvent) => void

export interface BusEvent {
  /** Event type — clients can filter by this. */
  type: 'designdoc-changed'
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
