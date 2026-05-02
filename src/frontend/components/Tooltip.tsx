import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface TooltipProps {
  text: string
  children: ReactNode
  /** Default 'bottom'. Tooltip flips to fit if it would overflow viewport. */
  side?: 'top' | 'bottom'
}

/**
 * Lightweight portal-based tooltip. Renders into document.body so it can't be
 * clipped by ancestor `overflow: hidden|auto` containers (e.g. resizable side
 * panels). Auto-flips top/bottom to stay inside the viewport, and clamps its
 * left position to the visible width so narrow placements still show.
 *
 * Hover or keyboard-focus the trigger to show; instant fade.
 */
export function Tooltip({ text, children, side = 'bottom' }: TooltipProps) {
  const triggerRef = useRef<HTMLSpanElement>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  // Recompute position on each show. Read trigger rect, place bubble centered
  // on it, then clamp to the viewport. After the bubble paints we measure
  // its real size and re-clamp horizontally.
  useEffect(() => {
    if (!open) return
    const trigger = triggerRef.current
    if (!trigger) return
    const r = trigger.getBoundingClientRect()
    const margin = 8
    const initial = {
      top: side === 'bottom' ? r.bottom + 6 : r.top - 6,
      left: r.left + r.width / 2,
    }
    setPos(initial)
    // Two-frame measure → clamp to viewport
    const handle = window.requestAnimationFrame(() => {
      const bubble = bubbleRef.current
      if (!bubble) return
      const w = bubble.offsetWidth
      const h = bubble.offsetHeight
      let top = side === 'bottom' ? r.bottom + 6 : r.top - h - 6
      // Flip if not enough room on chosen side.
      if (side === 'bottom' && top + h > window.innerHeight - margin) {
        top = r.top - h - 6
      } else if (side === 'top' && top < margin) {
        top = r.bottom + 6
      }
      // Clamp horizontally so the bubble stays in the viewport.
      const desiredLeft = r.left + r.width / 2 - w / 2
      const minLeft = margin
      const maxLeft = window.innerWidth - w - margin
      const left = Math.max(minLeft, Math.min(maxLeft, desiredLeft))
      setPos({ top, left })
    })
    return () => window.cancelAnimationFrame(handle)
  }, [open, side])

  return (
    <span
      ref={triggerRef}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      style={{ display: 'inline-flex' }}
    >
      {children}
      {open &&
        createPortal(
          <div
            ref={bubbleRef}
            role="tooltip"
            style={{
              position: 'fixed',
              top: pos?.top ?? -9999,
              left: pos?.left ?? -9999,
              background: 'var(--fg)',
              color: 'var(--bg)',
              padding: '4px 8px',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--fs-meta)',
              fontWeight: 500,
              lineHeight: 1.35,
              maxWidth: 280,
              boxShadow: 'var(--shadow-md)',
              pointerEvents: 'none',
              zIndex: 1000,
              opacity: pos ? 1 : 0,
              transition: 'opacity 80ms ease',
            }}
          >
            {text}
          </div>,
          document.body,
        )}
    </span>
  )
}
