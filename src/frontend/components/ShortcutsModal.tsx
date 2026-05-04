import { useEffect } from 'react'
import { useViewStore } from '../store/viewStore'

// Single source of truth for the keyboard shortcuts list. Add entries here as
// new shortcuts ship — the modal renders directly from this array, grouped
// by `group`. Keeping it co-located with the rendering avoids the doc going
// stale relative to the actual handlers in App.tsx.
interface Shortcut {
  keys: string[]
  description: string
  group: 'Navigation' | 'Selection' | 'Chain isolation' | 'Layout' | 'Other'
}

const SHORTCUTS: Shortcut[] = [
  { keys: ['Cmd', 'F'], description: 'Find on canvas (focus required: click into canvas first)', group: 'Navigation' },
  { keys: ['Esc'], description: 'Peel one layer: Find → context menu → focused issue → chain isolation', group: 'Navigation' },
  { keys: ['?'], description: 'Show this shortcut cheat sheet', group: 'Navigation' },

  { keys: ['Click'], description: 'Focus an issue (opens detail panel)', group: 'Selection' },
  { keys: ['Cmd', 'Click'], description: 'Toggle multi-select', group: 'Selection' },
  { keys: ['Right-click'], description: 'Open context menu on an issue', group: 'Selection' },
  { keys: ['Double-click'], description: 'Open issue in source (Linear)', group: 'Selection' },

  { keys: ['c'], description: 'Isolate chain on focused issue (preserve positions) — dependency view only', group: 'Chain isolation' },
  { keys: ['Shift', 'C'], description: 'Isolate chain (auto-layout — re-runs dagre and refits camera)', group: 'Chain isolation' },

  { keys: ['r'], description: 'Toggle Related-edges overlay (dependency view) — dashed gray lines for `related` issue links', group: 'Layout' },
  { keys: ['Shift', 'R'], description: 'Re-layout: re-run dagre from scratch; recenters on focused issue if any', group: 'Layout' },

  { keys: ['Cmd', 'Shift', 'S'], description: 'Save canvas screenshot as PNG', group: 'Other' },
]

const GROUP_ORDER: Shortcut['group'][] = ['Navigation', 'Selection', 'Chain isolation', 'Layout', 'Other']

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
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <h3 style={{ marginTop: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          Keyboard shortcuts
          <button onClick={close} title="Close (Esc)" style={{ fontSize: 14 }}>×</button>
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {grouped.map(({ group, items }) => (
            <section key={group}>
              <h4 style={{ margin: '0 0 8px 0', color: 'var(--fg-muted)', fontSize: 'var(--fs-meta)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {group}
              </h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 14px', alignItems: 'center' }}>
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
