import { useEffect } from 'react'
import { Copy, ExternalLink, Focus, GitBranch, Workflow } from 'lucide-react'
import { useViewStore } from '../store/viewStore'
import { useGraphStore } from '../store/graphStore'

export function ContextMenu() {
  const menu = useViewStore((s) => s.contextMenu)
  const close = () => useViewStore.getState().setContextMenu(null)
  const setFocusedId = useViewStore((s) => s.setFocusedId)
  const setChainRootId = useViewStore((s) => s.setChainRootId)
  const bumpLayout = useViewStore((s) => s.bumpLayout)
  const graph = useGraphStore((s) => s.graph)

  useEffect(() => {
    if (!menu) return
    const handler = () => close()
    window.addEventListener('click', handler)
    window.addEventListener('keydown', handler)
    return () => {
      window.removeEventListener('click', handler)
      window.removeEventListener('keydown', handler)
    }
  }, [menu])

  if (!menu) return null
  const issue = graph?.data.issues.find((i) => i.identifier === menu.targetIdentifier)
  if (!issue) return null

  return (
    <div className="context-menu" role="menu" style={{ left: menu.x, top: menu.y }}>
      <button
        role="menuitem"
        onClick={() => { window.open(issue.url, '_blank', 'noreferrer'); close() }}
      >
        <ExternalLink size={14} /> Open in source
      </button>
      <button
        role="menuitem"
        onClick={() => { navigator.clipboard.writeText(issue.identifier); close() }}
      >
        <Copy size={14} /> Copy ID
      </button>
      <button
        role="menuitem"
        onClick={() => { setFocusedId(issue.identifier); close() }}
      >
        <Focus size={14} /> Focus
      </button>
      <div className="context-menu-sep" role="separator" />
      <button
        role="menuitem"
        onClick={() => { setChainRootId(issue.identifier); close() }}
        title="Shortcut: focus an issue, press c"
      >
        <GitBranch size={14} /> Isolate chain
        <span className="context-menu-hint">c</span>
      </button>
      <button
        role="menuitem"
        onClick={() => { setChainRootId(issue.identifier); bumpLayout(); close() }}
        title="Shortcut: focus an issue, press Shift+C"
      >
        <Workflow size={14} /> Isolate chain (auto-layout)
        <span className="context-menu-hint">⇧C</span>
      </button>
    </div>
  )
}
