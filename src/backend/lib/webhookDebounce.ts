// Trailing debounce for webhook-triggered syncs, keyed by workspace.
//
// Linear emits one webhook per changed entity, so a bulk edit or a script
// arrives as a burst within a second or two. One sync covers all of them —
// the sync is incremental against an `updatedAt` high-water mark, so it picks
// up everything that changed regardless of how many notifications preceded it.
// Firing per request would just spend API quota to compute the same answer.
//
// The caller is responsible for binding the workspace context into `job`
// (see routes/webhooks.ts): the timer fires long after the request's
// AsyncLocalStorage scope has closed, and a debounce that reschedules across
// requests would otherwise inherit whichever request happened to arm it.

const DEFAULT_QUIET_MS = 2000

const timers = new Map<string, ReturnType<typeof setTimeout>>()

export function scheduleWorkspaceSync(
  workspaceId: string,
  job: () => Promise<void>,
  quietMs: number = DEFAULT_QUIET_MS,
): void {
  const existing = timers.get(workspaceId)
  if (existing) clearTimeout(existing)

  timers.set(
    workspaceId,
    setTimeout(() => {
      timers.delete(workspaceId)
      // Detached on purpose — nothing awaits a webhook-triggered sync, and a
      // rejection here must not become an unhandled rejection that takes the
      // process down. Failures are visible in the log and in the webhook
      // stats; the next event schedules a fresh attempt.
      void job().catch(() => undefined)
    }, quietMs),
  )
}

/** Test seam: drop every pending timer so cases cannot bleed into each other. */
export function __resetDebounceForTests(): void {
  for (const t of timers.values()) clearTimeout(t)
  timers.clear()
}
