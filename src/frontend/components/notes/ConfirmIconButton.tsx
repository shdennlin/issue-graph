import { useEffect, useRef, useState, type ReactNode } from 'react'

interface Props {
  icon: ReactNode
  title: string
  ariaLabel: string
  onConfirm: () => void
  className?: string
  /** Tone determines the "pending" visual treatment. */
  tone?: 'danger' | 'warning' | 'neutral'
  /** Optional override for the confirm-state icon. Defaults to `icon`. */
  confirmIcon?: ReactNode
  /** Optional override for the confirm-state tooltip. */
  confirmTitle?: string
}

const CONFIRM_TIMEOUT_MS = 3000

/**
 * Icon-only button with built-in 2-step confirmation. First click flips the
 * button into a "pending" visual state with an updated tooltip; second click
 * within {@link CONFIRM_TIMEOUT_MS} fires {@link Props.onConfirm}. Clicks on
 * other elements or a timeout reset the state.
 *
 * `e.stopPropagation()` on both pointer-down and click so the host card's
 * own onClick (which would open the editor) never fires.
 */
export function ConfirmIconButton({
  icon,
  title,
  ariaLabel,
  onConfirm,
  className,
  tone = 'danger',
  confirmIcon,
  confirmTitle,
}: Props) {
  const [pending, setPending] = useState(false)
  const timerRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    return () => {
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current)
    }
  }, [])

  function reset() {
    if (timerRef.current !== undefined) {
      window.clearTimeout(timerRef.current)
      timerRef.current = undefined
    }
    setPending(false)
  }

  function onClick(e: React.MouseEvent<HTMLButtonElement>) {
    e.stopPropagation()
    if (pending) {
      reset()
      onConfirm()
      return
    }
    setPending(true)
    timerRef.current = window.setTimeout(() => {
      timerRef.current = undefined
      setPending(false)
    }, CONFIRM_TIMEOUT_MS)
  }

  // Cancel pending state when the user clicks anywhere else on the page.
  useEffect(() => {
    if (!pending) return
    const onDocPointer = (e: PointerEvent) => {
      const tgt = e.target as HTMLElement | null
      // Ignore clicks on the button itself — that's what advances state.
      if (tgt && tgt.closest('.confirm-icon-button.pending')) return
      reset()
    }
    document.addEventListener('pointerdown', onDocPointer, true)
    return () => document.removeEventListener('pointerdown', onDocPointer, true)
  }, [pending])

  const finalTitle = pending ? (confirmTitle ?? 'Click again to confirm') : title

  return (
    <button
      type="button"
      className={`confirm-icon-button${pending ? ` pending tone-${tone}` : ''}${className ? ' ' + className : ''}`}
      onClick={onClick}
      onPointerDown={(e) => e.stopPropagation()}
      title={finalTitle}
      aria-label={ariaLabel}
      aria-pressed={pending}
    >
      {pending && confirmIcon ? confirmIcon : icon}
    </button>
  )
}
