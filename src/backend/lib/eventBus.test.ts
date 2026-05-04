import { describe, it, expect, beforeEach } from 'vitest'
import { subscribe, publish, listenerCount, type BusEvent } from './eventBus.js'

describe('eventBus', () => {
  beforeEach(() => {
    // Drain any leftover listeners between tests so listenerCount starts at 0.
    while (listenerCount() > 0) {
      // Re-subscribe + immediately unsubscribe to clear via the public API.
      // Cheaper: just accept that `listenerCount()` is the source of truth and
      // each test cleans up its own subscriptions.
      break
    }
  })

  it('delivers published events to subscribed listeners', () => {
    const seen: string[] = []
    const off = subscribe((e: BusEvent) => seen.push(e.type))
    publish({ type: 'designdoc-changed' })
    publish({ type: 'designdoc-changed', data: { foo: 1 } })
    expect(seen).toEqual(['designdoc-changed', 'designdoc-changed'])
    off()
  })

  it('passes the event payload through unchanged', () => {
    let received: unknown = null
    const off = subscribe((e: BusEvent) => {
      received = e.data
    })
    publish({ type: 'designdoc-changed', data: { count: 5, name: 'x' } })
    expect(received).toEqual({ count: 5, name: 'x' })
    off()
  })

  it('unsubscribe stops delivery', () => {
    let count = 0
    const off = subscribe(() => {
      count += 1
    })
    publish({ type: 'designdoc-changed' })
    off()
    publish({ type: 'designdoc-changed' })
    expect(count).toBe(1)
  })

  it('a listener throwing does not poison delivery to other listeners', () => {
    let secondReceived = false
    const offBad = subscribe(() => {
      throw new Error('boom')
    })
    const offGood = subscribe(() => {
      secondReceived = true
    })
    publish({ type: 'designdoc-changed' })
    expect(secondReceived).toBe(true)
    offBad()
    offGood()
  })

  it('listener that unsubscribes itself mid-delivery does not break iteration', () => {
    // Snapshot-before-iterate guarantees an unsubscribe inside one listener
    // doesn't perturb the rest of the dispatch for this event.
    let aSeen = 0
    let bSeen = 0
    let offA: (() => void) | null = null
    const offB = subscribe(() => {
      bSeen += 1
    })
    offA = subscribe(() => {
      aSeen += 1
      if (offA) offA()
    })
    publish({ type: 'designdoc-changed' })
    expect(aSeen).toBe(1)
    expect(bSeen).toBe(1)
    offB()
  })

  it('listenerCount reflects active subscriptions', () => {
    const start = listenerCount()
    const off1 = subscribe(() => undefined)
    const off2 = subscribe(() => undefined)
    expect(listenerCount()).toBe(start + 2)
    off1()
    expect(listenerCount()).toBe(start + 1)
    off2()
    expect(listenerCount()).toBe(start)
  })
})
