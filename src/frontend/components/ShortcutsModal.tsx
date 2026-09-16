import { useEffect } from 'react'
import { useViewStore } from '../store/viewStore'
import { localizeKey, NOTE_TOGGLE_KEYS } from '../lib/platform'
import { ModalHeader } from './ModalHeader'
import { useT, type DictKey } from '../i18n'

// Single source of truth for the keyboard shortcuts list. Add entries here as
// new shortcuts ship — the modal renders directly from this array, grouped
// by `group`. Descriptions are i18n keys under `shortcuts.items.*` so locales
// can translate the prose without touching `keys` (the visible key glyphs
// stay identical across languages).
type Group = 'Navigation' | 'Selection' | 'Chain isolation' | 'Layout' | 'Notes' | 'Quick switcher' | 'Other'
interface Shortcut {
  keys: string[]
  descriptionKey: DictKey
  group: Group
}

const SHORTCUTS: Shortcut[] = [
  { keys: ['Cmd', '['], descriptionKey: 'shortcuts.items.back', group: 'Navigation' },
  { keys: ['Cmd', ']'], descriptionKey: 'shortcuts.items.forward', group: 'Navigation' },
  { keys: ['Cmd', 'F'], descriptionKey: 'shortcuts.items.find', group: 'Navigation' },
  { keys: ['Cmd', 'Shift', 'F'], descriptionKey: 'shortcuts.items.focusToolbarSearch', group: 'Navigation' },
  { keys: ['Cmd', 'K'], descriptionKey: 'shortcuts.items.quickSwitcherOpen', group: 'Navigation' },
  { keys: ['Enter'], descriptionKey: 'shortcuts.items.findNext', group: 'Navigation' },
  { keys: ['Esc'], descriptionKey: 'shortcuts.items.esc', group: 'Navigation' },
  { keys: ['?'], descriptionKey: 'shortcuts.items.cheatsheet', group: 'Navigation' },
  { keys: ['n'], descriptionKey: 'shortcuts.items.notesToggle', group: 'Notes' },
  { keys: NOTE_TOGGLE_KEYS, descriptionKey: 'shortcuts.items.noteEditPreview', group: 'Notes' },
  { keys: ['Delete'], descriptionKey: 'shortcuts.items.notesBack', group: 'Notes' },

  { keys: ['Click'], descriptionKey: 'shortcuts.items.click', group: 'Selection' },
  { keys: ['Space'], descriptionKey: 'shortcuts.items.space', group: 'Selection' },
  { keys: ['Enter'], descriptionKey: 'shortcuts.items.enter', group: 'Selection' },
  { keys: ['d'], descriptionKey: 'shortcuts.items.detailPanelToggle', group: 'Selection' },
  { keys: ['Shift', 'D'], descriptionKey: 'shortcuts.items.detailAutoToggle', group: 'Selection' },
  { keys: ['m'], descriptionKey: 'shortcuts.items.detailWideToggle', group: 'Selection' },
  { keys: ['Cmd', 'Shift', 'C'], descriptionKey: 'shortcuts.items.detailCopyId', group: 'Selection' },
  { keys: ['Cmd', 'Click'], descriptionKey: 'shortcuts.items.cmdClick', group: 'Selection' },
  { keys: ['Right-click'], descriptionKey: 'shortcuts.items.rightClick', group: 'Selection' },
  { keys: ['Double-click'], descriptionKey: 'shortcuts.items.doubleClick', group: 'Selection' },

  { keys: ['c'], descriptionKey: 'shortcuts.items.chainPreserve', group: 'Chain isolation' },
  { keys: ['Shift', 'C'], descriptionKey: 'shortcuts.items.chainAuto', group: 'Chain isolation' },

  { keys: ['r'], descriptionKey: 'shortcuts.items.relatedToggle', group: 'Layout' },
  { keys: ['h'], descriptionKey: 'shortcuts.items.hierarchyToggle', group: 'Layout' },
  { keys: ['Shift', 'R'], descriptionKey: 'shortcuts.items.relayout', group: 'Layout' },

  { keys: ['Cmd', 'Alt', 'S'], descriptionKey: 'shortcuts.items.refresh', group: 'Other' },
  { keys: ['Cmd', 'Shift', 'S'], descriptionKey: 'shortcuts.items.screenshot', group: 'Other' },

  { keys: ['Ctrl', 'J'], descriptionKey: 'shortcuts.items.quickSwitcherDown', group: 'Quick switcher' },
  { keys: ['Ctrl', 'N'], descriptionKey: 'shortcuts.items.quickSwitcherDown', group: 'Quick switcher' },
  { keys: ['Ctrl', 'K'], descriptionKey: 'shortcuts.items.quickSwitcherUp', group: 'Quick switcher' },
  { keys: ['Ctrl', 'P'], descriptionKey: 'shortcuts.items.quickSwitcherUp', group: 'Quick switcher' },
  { keys: ['Cmd', 'Enter'], descriptionKey: 'shortcuts.items.quickSwitcherOpenInNewTab', group: 'Quick switcher' },
]

const GROUP_ORDER: Group[] = ['Navigation', 'Selection', 'Chain isolation', 'Layout', 'Notes', 'Quick switcher', 'Other']

const GROUP_KEY: Record<Group, DictKey> = {
  Navigation: 'shortcuts.groups.Navigation',
  Selection: 'shortcuts.groups.Selection',
  'Chain isolation': 'shortcuts.groups.Chain isolation',
  Layout: 'shortcuts.groups.Layout',
  Notes: 'shortcuts.groups.Notes',
  'Quick switcher': 'shortcuts.groups.Quick switcher',
  Other: 'shortcuts.groups.Other',
}

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
  const t = useT()

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
        <ModalHeader title={t('shortcuts.title')} onClose={close} />
        <div className="shortcuts-columns">
          {grouped.map(({ group, items }) => (
            <section key={group} className="shortcuts-section">
              <h4 className="shortcuts-section-title">{t(GROUP_KEY[group])}</h4>
              <div className="shortcuts-grid">
                {items.map((s, idx) => (
                  <ShortcutRow key={`${group}-${idx}`} keys={s.keys} description={t(s.descriptionKey)} />
                ))}
              </div>
            </section>
          ))}
        </div>
        <div style={{ marginTop: 16, color: 'var(--fg-muted)', fontSize: 'var(--fs-meta)' }}>
          {t('shortcuts.note')}
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
            <Key>{localizeKey(k)}</Key>
          </span>
        ))}
      </div>
      <div style={{ fontSize: 'var(--fs-base)' }}>{description}</div>
    </>
  )
}
