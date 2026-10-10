// Collapse a burst of calls into one, run `ms` after the FIRST call of the
// burst rather than after the last.
//
// For `workstreams-changed`: an agent at work sends a session heartbeat on
// every edit and every prompt, and a refetch per event would be several full
// graph fetches a second. A trailing debounce would be worse in a different
// way — under a steady stream of heartbeats it would never fire at all, and
// the board would stop updating exactly while something is happening on it.
// Firing a fixed interval after the first call bounds the delay instead.

export function coalesce(fn: () => void, ms: number): { call: () => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null
  return {
    call() {
      if (timer !== null) return
      timer = setTimeout(() => {
        timer = null
        fn()
      }, ms)
    },
    cancel() {
      if (timer !== null) clearTimeout(timer)
      timer = null
    },
  }
}
