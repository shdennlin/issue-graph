import { useEffect } from 'react'
import { useNotificationStore } from '../store/notificationStore'
import { useViewStore } from '../store/viewStore'
import { useT } from '../i18n'

/** How long the banner stays up. Long enough to read an identifier, short
 *  enough not to sit over the graph while you work. */
const TOAST_MS = 8000

/**
 * "Something changed while you were looking elsewhere in the app."
 *
 * Announces a whole sync, not an issue: an agent writing in bulk produces one
 * burst, and one banner per issue would stack a dozen of them for what the
 * person experienced as a single act. The identifiers live in the bell
 * popover; this only says how many and offers a way in.
 */
export function NotificationToast() {
  const toast = useNotificationStore((s) => s.toast)
  const dismiss = useNotificationStore((s) => s.dismissToast)
  const setNotificationsOpen = useViewStore((s) => s.setNotificationsOpen)
  const t = useT()

  // Any modal open means the person is doing something deliberate in a focused
  // surface. Floating a banner over it is wrong regardless of what it says —
  // the bell badge still counts the change, so nothing is lost by staying
  // quiet until they come back out.
  const modalOpen = useViewStore(
    (s) =>
      s.settingsOpen || s.syncHistoryOpen || s.coverageOpen || s.shortcutsOpen || s.notesOpen,
  )

  // One timeout that actually clears the toast, rather than a ticker that
  // re-renders until something else happens to replace it. Hiding on an elapsed
  // comparison left `toast` set, and with it as the effect's only dependency
  // the interval went on firing for the rest of the session.
  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(dismiss, Math.max(0, toast.at + TOAST_MS - Date.now()))
    return () => window.clearTimeout(id)
  }, [toast, dismiss])

  if (!toast || modalOpen) return null

  return (
    <div className="notif-toast" role="status">
      <span>
        {toast.count === 1
          ? t('notifications.toastOne')
          : t('notifications.toastMany', { count: toast.count })}
      </span>
      <button
        type="button"
        className="notif-toast-action"
        onClick={() => {
          dismiss()
          setNotificationsOpen(true)
        }}
      >
        {t('notifications.toastView')}
      </button>
      <button
        type="button"
        className="notif-toast-close"
        onClick={() => dismiss()}
        aria-label={t('notifications.toastDismiss')}
        title={t('notifications.toastDismiss')}
      >
        ×
      </button>
    </div>
  )
}
