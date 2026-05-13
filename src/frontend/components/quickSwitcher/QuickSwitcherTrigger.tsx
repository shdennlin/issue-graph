import { useQuickSwitcherStore } from '../../store/quickSwitcherStore'

export function QuickSwitcherTrigger() {
  const open = useQuickSwitcherStore((s) => s.openPalette)
  return (
    <button
      type="button"
      onClick={open}
      title="Quick switcher (⌘K)"
      aria-label="Open quick switcher"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '4px 8px', fontSize: 12, lineHeight: 1.2,
        background: 'transparent', color: 'inherit',
        border: '1px solid var(--border, #444)', borderRadius: 4,
        cursor: 'pointer',
      }}
    >
      <span aria-hidden>🔎</span>
      <span style={{ opacity: 0.75 }}>⌘K</span>
    </button>
  )
}
