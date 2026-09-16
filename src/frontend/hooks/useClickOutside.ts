import { useEffect, type RefObject } from 'react'

/**
 * Run `onOutside` when a `mousedown` happens outside `ref` and `active` is true.
 * Listener is only attached while active, so popovers / dropdowns can declare
 * `useClickOutside(ref, isOpen, () => setOpen(false))` without leaking handlers.
 *
 * Registered in the CAPTURE phase, which is load-bearing rather than
 * stylistic: React Flow pans via d3-drag, and d3-drag calls
 * `stopImmediatePropagation()` on the pane's mousedown. A bubble-phase listener
 * on window therefore never fires for a click on the graph, so every dropdown
 * in the app stayed open when you clicked the canvas to dismiss it. Capture
 * runs before the target's own handlers, so it cannot be suppressed that way.
 */
export function useClickOutside(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  onOutside: () => void,
): void {
  useEffect(() => {
    if (!active) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside()
    }
    window.addEventListener('mousedown', onDown, true)
    return () => window.removeEventListener('mousedown', onDown, true)
  }, [active, ref, onOutside])
}
