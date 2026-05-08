import { useEffect, type RefObject } from 'react'

/**
 * Run `onOutside` when a `mousedown` happens outside `ref` and `active` is true.
 * Listener is only attached while active, so popovers / dropdowns can declare
 * `useClickOutside(ref, isOpen, () => setOpen(false))` without leaking handlers.
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
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [active, ref, onOutside])
}
