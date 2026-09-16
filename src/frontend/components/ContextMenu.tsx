import { useEffect } from 'react'
import { Copy, ExternalLink, Focus, GitBranch, Layers, Workflow } from 'lucide-react'
import { useViewStore } from '../store/viewStore'
import { useGraphStore } from '../store/graphStore'
import { api } from '../lib/api'

export function ContextMenu() {
  const menu = useViewStore((s) => s.contextMenu)
  const close = () => useViewStore.getState().setContextMenu(null)
  const setFocusedId = useViewStore((s) => s.setFocusedId)
  const setChainRootId = useViewStore((s) => s.setChainRootId)
  const setChainRootIds = useViewStore((s) => s.setChainRootIds)
  const selection = useViewStore((s) => s.selection)
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
      {selection.length > 1 && (
        <>
          <div className="context-menu-sep" role="separator" />
          <button
            role="menuitem"
            onClick={() => { setChainRootIds(selection); close() }}
            title="Isolate the combined chains of all selected issues"
          >
            <GitBranch size={14} /> Isolate chain of {selection.length} selected
            <span className="context-menu-hint">c</span>
          </button>
          <button
            role="menuitem"
            onClick={() => { setChainRootIds(selection); bumpLayout(); close() }}
            title="Isolate the combined chains of all selected issues (auto-layout)"
          >
            <Workflow size={14} /> Isolate selected chains (auto-layout)
            <span className="context-menu-hint">⇧C</span>
          </button>
          <button
            role="menuitem"
            onClick={() => {
              // Only membership is sent. The order to work in is a topological
              // sort over `blocks`, computed server-side on every read, because
              // those edges live in Linear and change without us.
              const name = `${selection[0]} +${selection.length - 1}`
              void api
                .createBatch(name, selection)
                .then(() => useGraphStore.getState().refetchSilent())
                .catch(() => {
                  /* Non-fatal: the graph is unchanged and the menu has closed. */
                })
              close()
            }}
            title="Queue these issues for agent sessions to claim one at a time, in dependency order"
          >
            <Layers size={14} /> Queue {selection.length} as a batch
          </button>
        </>
      )}
    </div>
  )
}
