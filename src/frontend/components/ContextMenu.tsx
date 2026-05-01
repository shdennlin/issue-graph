import { useEffect } from 'react'
import { useViewStore } from '../store/viewStore'
import { useGraphStore } from '../store/graphStore'

export function ContextMenu() {
  const menu = useViewStore((s) => s.contextMenu)
  const close = () => useViewStore.getState().setContextMenu(null)
  const setFocusedId = useViewStore((s) => s.setFocusedId)
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
    <div className="context-menu" style={{ left: menu.x, top: menu.y }}>
      <button onClick={() => { window.open(issue.url, '_blank', 'noreferrer'); close() }}>Open in source ↗</button>
      <button onClick={() => { navigator.clipboard.writeText(issue.identifier); close() }}>Copy ID</button>
      <button onClick={() => { setFocusedId(issue.identifier); close() }}>Focus</button>
    </div>
  )
}
