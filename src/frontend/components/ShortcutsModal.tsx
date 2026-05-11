import { useEffect } from 'react'
import { useViewStore } from '../store/viewStore'
import { ModalHeader } from './ModalHeader'

// Single source of truth for the keyboard shortcuts list. Add entries here as
// new shortcuts ship — the modal renders directly from this array, grouped
// by `group`. Keeping it co-located with the rendering avoids the doc going
// stale relative to the actual handlers in App.tsx.
interface Shortcut {
  keys: string[]
  description: string
  group: 'Navigation' | 'Selection' | 'Chain isolation' | 'Layout' | 'Notes' | 'Other'
}

const SHORTCUTS: Shortcut[] = [
  { keys: ['Cmd', '['], description: 'Back — undo last view / filter / focus / chain change (also restores viewport)', group: 'Navigation' },
  { keys: ['Cmd', ']'], description: 'Forward — redo a step previously undone', group: 'Navigation' },
  { keys: ['Cmd', 'F'], description: 'Find on canvas (click into canvas first)', group: 'Navigation' },
  { keys: ['Cmd', 'Shift', 'F'], description: 'Focus the toolbar filter search', group: 'Navigation' },
  { keys: ['Enter'], description: 'In Find: next match + return keyboard to canvas', group: 'Navigation' },
  { keys: ['Esc'], description: 'Peel: Find → context menu → detail panel → focus → chain', group: 'Navigation' },
  { keys: ['?'], description: 'Show this cheat sheet', group: 'Navigation' },
  { keys: ['n'], description: 'Toggle workspace notes — reopens to the last view (grid or last note). Esc closes the modal entirely; use ← Back inside the editor to return to grid', group: 'Notes' },
  { keys: ['Cmd', 'E'], description: 'Toggle Edit / Preview inside an open note', group: 'Notes' },
  { keys: ['Delete'], description: '← Back to grid from the editor (Backspace on non-Mac keyboards). Ignored while typing in the textarea', group: 'Notes' },

  { keys: ['Click'], description: 'Focus an issue (auto-opens detail when toolbar Detail toggle is on)', group: 'Selection' },
  { keys: ['Space'], description: 'Open detail panel for focused issue (ad-hoc, works when auto-open is off)', group: 'Selection' },
  { keys: ['Enter'], description: 'Same as Space — open detail panel', group: 'Selection' },
  { keys: ['Cmd', 'Click'], description: 'Toggle multi-select', group: 'Selection' },
  { keys: ['Right-click'], description: 'Open context menu', group: 'Selection' },
  { keys: ['Double-click'], description: 'Open issue in source (Linear)', group: 'Selection' },

  { keys: ['c'], description: 'Isolate chain on focused issue (preserve positions)', group: 'Chain isolation' },
  { keys: ['Shift', 'C'], description: 'Isolate chain (auto-layout)', group: 'Chain isolation' },

  { keys: ['r'], description: 'Toggle Related-edges overlay (dashed gray, dependency view)', group: 'Layout' },
  { keys: ['Shift', 'R'], description: 'Re-layout from scratch; recenters on focused issue if any', group: 'Layout' },

  { keys: ['Cmd', 'Shift', 'S'], description: 'Save canvas screenshot as PNG', group: 'Other' },
]

const GROUP_ORDER: Shortcut['group'][] = ['Navigation', 'Selection', 'Chain isolation', 'Layout', 'Notes', 'Other']

function Key({ children }: { children: string }) {
  return (
    <kbd
      style={{
        display: 'inline-block',
        minWidth: 22,
        padding: '2px 6px',
        background: 'var(--bg-elev)',
        border: '1px solid var(--node-border)',
        borderBottomWidth: 2,
        borderRadius: 4,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 11,
        textAlign: 'center',
        lineHeight: 1.4,
        color: 'var(--fg)',
      }}
    >
      {children}
    </kbd>
  )
}

export function ShortcutsModal() {
  const open = useViewStore((s) => s.shortcutsOpen)
  const close = () => useViewStore.getState().setShortcutsOpen(false)

  // Esc closes the modal. App.tsx's window-level Esc handler already exits
  // early when a modal is open, so this is the only Esc handler in play.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null

  const grouped = GROUP_ORDER.map((g) => ({
    group: g,
    items: SHORTCUTS.filter((s) => s.group === g),
  })).filter((g) => g.items.length > 0)

  return (
    <div className="modal-backdrop" onClick={close}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 900, width: '90vw', maxHeight: '92vh' }}
      >
        <ModalHeader title="Keyboard shortcuts" onClose={close} />
        <div className="shortcuts-columns">
          {grouped.map(({ group, items }) => (
            <section key={group} className="shortcuts-section">
              <h4 className="shortcuts-section-title">{group}</h4>
              <div className="shortcuts-grid">
                {items.map((s, idx) => (
                  <ShortcutRow key={`${group}-${idx}`} keys={s.keys} description={s.description} />
                ))}
              </div>
            </section>
          ))}
        </div>
        <div style={{ marginTop: 16, color: 'var(--fg-muted)', fontSize: 'var(--fs-meta)' }}>
          Shortcuts are ignored while typing in inputs / textareas / a focused search box.
        </div>
      </div>
    </div>
  )
}

function ShortcutRow({ keys, description }: { keys: string[]; description: string }) {
  return (
    <>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', whiteSpace: 'nowrap' }}>
        {keys.map((k, i) => (
          <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {i > 0 && <span style={{ color: 'var(--fg-muted)' }}>+</span>}
            <Key>{k}</Key>
          </span>
        ))}
      </div>
      <div style={{ fontSize: 'var(--fs-base)' }}>{description}</div>
    </>
  )
}
