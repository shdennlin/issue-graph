// What an in-app tab is called.
//
// It used to be the workspace's name, which with one workspace is the same on
// every tab: three tabs read "OneLegion", and the only thing setting a Raycast
// preview tab apart was italics. A tab is named for what it is LOOKING AT
// instead — the workstream it follows, the issue it is on — and the workspace
// drops to a marker that appears only when there is more than one to tell
// apart.
//
// Pure, because TabBar is a `.tsx` and outside vitest's glob, and because it
// must work for tabs that are not on screen: those are named from their
// snapshot, not from the live store.

import type { ViewId } from '../store/viewStore'

export interface TabLabelState {
  activeView: ViewId
  focusedId: string | null
  focusedWorkstreamId: number | null
  savedViewName: string | null
}

export type TabLabel =
  /** `name` is null when the workstream is not in the graph this tab can see
   *  — another workspace's tab before it has been visited this session. */
  | { kind: 'workstream'; id: number; name: string | null }
  | { kind: 'workstreams' }
  | { kind: 'issue'; identifier: string }
  | { kind: 'saved'; name: string }
  | { kind: 'view'; view: ViewId }

export function tabLabel(
  state: TabLabelState,
  workstreamName: (id: number) => string | null,
): TabLabel {
  // The workstream view first: it draws stages, not issues, so a focusedId
  // left over from another view says nothing about what is on screen.
  if (state.activeView === 'workstream') {
    const id = state.focusedWorkstreamId
    return id === null ? { kind: 'workstreams' } : { kind: 'workstream', id, name: workstreamName(id) }
  }
  // An issue before a saved view: a focused issue is the narrower claim about
  // what the tab is for, and it is what a Raycast jump sets.
  if (state.focusedId) return { kind: 'issue', identifier: state.focusedId }
  if (state.savedViewName) return { kind: 'saved', name: state.savedViewName }
  return { kind: 'view', view: state.activeView }
}

/**
 * A stable hue per workspace, for the marker shown when several are open.
 * Hashed rather than assigned so it does not change when tabs are reordered or
 * a workspace is added — a colour that moves is worse than none.
 */
export function workspaceHue(workspaceId: string): number {
  let h = 0
  for (let i = 0; i < workspaceId.length; i++) h = (h * 31 + workspaceId.charCodeAt(i)) >>> 0
  return h % 360
}
