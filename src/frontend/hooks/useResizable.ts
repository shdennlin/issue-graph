import { useCallback, useEffect, useRef, useState } from 'react'

interface Options {
  storageKey: string       // localStorage key for persistence
  defaultWidth: number     // initial width when nothing stored yet
  min: number              // px — clamp lower bound (avoid hidden / unrecoverable)
  max: number              // px — clamp upper bound (avoid eating canvas)
  side: 'left' | 'right'   // which edge the handle lives on
}

interface Result {
  width: number
  startResize: (e: React.MouseEvent) => void
  resizing: boolean
}

// Generic horizontal resizer for sidebar panels. Mouse-only (touch-resize is
// rare for this kind of dev tool). Persists width per storageKey.
//
// Usage:
//   const { width, startResize, resizing } = useResizable({
//     storageKey: 'ig-filter-w',
//     defaultWidth: 240, min: 180, max: 480, side: 'left',
//   })
//   <aside style={{ width }}>...
//     <div className="resize-handle" onMouseDown={startResize} />
//   </aside>
export function useResizable(opts: Options): Result {
  const [width, setWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return opts.defaultWidth
    const stored = window.localStorage?.getItem(opts.storageKey)
    const n = stored ? Number(stored) : NaN
    if (Number.isFinite(n) && n >= opts.min && n <= opts.max) return n
    return opts.defaultWidth
  })
  const [resizing, setResizing] = useState(false)
  const dragRef = useRef<{ startX: number; startW: number } | null>(null)

  const startResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      dragRef.current = { startX: e.clientX, startW: width }
      setResizing(true)
    },
    [width],
  )

  useEffect(() => {
    if (!resizing) return

    const onMove = (e: MouseEvent) => {
      const drag = dragRef.current
      if (!drag) return
      const delta = e.clientX - drag.startX
      // Left panel grows when handle pulled right; right panel grows when handle pulled left.
      const next = opts.side === 'left' ? drag.startW + delta : drag.startW - delta
      const clamped = Math.max(opts.min, Math.min(opts.max, next))
      setWidth(clamped)
    }
    const onUp = () => {
      dragRef.current = null
      setResizing(false)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    // While dragging, prevent text selection / cursor flicker.
    const prevUserSelect = document.body.style.userSelect
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'

    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.userSelect = prevUserSelect
      document.body.style.cursor = ''
    }
  }, [resizing, opts.side, opts.min, opts.max])

  // Persist after each width change (debounced via simple setTimeout).
  useEffect(() => {
    if (typeof window === 'undefined') return
    const id = window.setTimeout(() => {
      window.localStorage?.setItem(opts.storageKey, String(width))
    }, 100)
    return () => window.clearTimeout(id)
  }, [width, opts.storageKey])

  return { width, startResize, resizing }
}
