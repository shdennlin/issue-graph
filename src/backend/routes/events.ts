// Server-Sent Events stream. Single endpoint /api/events; clients open
// an EventSource and receive named events as background tasks publish them
// (currently: 'designdoc-changed' from the file watcher).
//
// Why SSE not WebSocket: pure server → client push, simple HTTP, works
// through any reverse proxy without upgrade handshake, no library needed.

import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { subscribe, type BusEvent } from '../lib/eventBus.js'

export const eventsRoutes = new Hono()

eventsRoutes.get('/api/events', (c) =>
  streamSSE(c, async (stream) => {
    // Hold the stream open and forward bus events to it as they arrive.
    // Each subscriber gets its own queue via the closure.
    const queue: BusEvent[] = []
    let resolve: (() => void) | null = null
    const wake = () => {
      const r = resolve
      resolve = null
      if (r) r()
    }

    const unsubscribe = subscribe((evt) => {
      queue.push(evt)
      wake()
    })

    // Keep-alive ping every 25s — proxies and browsers tend to drop idle
    // streams around 30–60s. Comments are valid SSE noise that don't fire
    // any client-side event handler.
    const ping = setInterval(() => {
      stream.writeSSE({ data: '', event: 'ping' }).catch(() => undefined)
    }, 25_000)

    // On stream abort, clean up.
    stream.onAbort(() => {
      clearInterval(ping)
      unsubscribe()
      wake()
    })

    // Initial 'hello' so the client can flag the stream as live.
    await stream.writeSSE({ event: 'hello', data: JSON.stringify({ ts: Date.now() }) })

    // Drain loop — wait for events, write them, repeat.
    while (true) {
      while (queue.length > 0) {
        const evt = queue.shift()!
        await stream.writeSSE({
          event: evt.type,
          data: JSON.stringify(evt.data ?? {}),
        })
      }
      // Park until next publish. wake() resolves this promise.
      await new Promise<void>((r) => {
        resolve = r
      })
      // Re-check abort state via stream's own facility — if onAbort fired,
      // the wake call resolved this promise; the next writeSSE will throw
      // and we'll exit. Cheap exit path without an explicit aborted flag.
      if (queue.length === 0) {
        // No event arrived; means we were woken by abort. Break out.
        break
      }
    }
  }),
)
