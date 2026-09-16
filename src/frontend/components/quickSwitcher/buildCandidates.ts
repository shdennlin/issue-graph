import type { Tab } from '../../store/workspaceStore'
import type { GraphResponse, NoteDTO } from '@shared/types.js'
import type { Candidate, IssueCandidate, NoteCandidate, TabCandidate } from './types'

interface Args {
  tabs: Tab[]
  activeTabId: string | null
  workspaceName: (workspaceId: string) => string
  /** Graph for the active tab (lives in useGraphStore). */
  activeGraph: GraphResponse | null
  /** Graph snapshot for a non-active tab (from tabStateStore). null if absent. */
  snapshotGraph: (tabId: string) => GraphResponse | null
  /** Notes are workspace-scoped today. Caller groups by tab; archived filtered downstream. */
  notesByTab: Record<string, NoteDTO[]>
}

function deriveNoteTitle(body: string): string {
  for (const line of body.split('\n')) {
    const t = line.trim()
    if (t) return t.replace(/^#+\s*/, '').slice(0, 120)
  }
  return 'Untitled note'
}

function deriveNoteSnippet(body: string): string {
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean)
  return (lines[1] ?? '').slice(0, 80)
}

export function buildCandidates(args: Args): Candidate[] {
  const out: Candidate[] = []

  // Issues — one pass per tab, then one row per issue.
  //
  // Two tabs may sit on the same workspace (they keep independent filters), and
  // an issue reached through either is the same issue. Emitting it once per tab
  // put indistinguishable rows next to each other: the only thing separating
  // them is which tab would open, and the row shows `scopeLabel`, the workspace
  // name, which is identical by construction.
  //
  // Keyed by workspace rather than globally, because the same identifier in two
  // different workspaces really is two different issues — and there the scope
  // label does tell them apart.
  const seen = new Set<string>()
  // Active tab first so its copy is the one kept: opening an issue should land
  // in the tab you are already looking at. The rest keep their given order, so
  // the fallback is the first tab holding the issue, not an arbitrary one.
  const tabsByPreference = [...args.tabs].sort(
    (a, b) => Number(b.id === args.activeTabId) - Number(a.id === args.activeTabId),
  )
  for (const tab of tabsByPreference) {
    const isActive = tab.id === args.activeTabId
    const graph = isActive ? args.activeGraph : args.snapshotGraph(tab.id)
    const issues = (graph as any)?.data?.issues as
      | {
          id: string
          identifier: string
          title: string
          labels: { name: string }[]
          state?: { name: string; type: string }
        }[]
      | undefined
    if (!issues) continue
    const scopeLabel = args.workspaceName(tab.workspaceId)
    for (const i of issues) {
      const key = `${tab.workspaceId}:${i.identifier}`
      if (seen.has(key)) continue
      seen.add(key)
      const cand: IssueCandidate = {
        kind: 'issue',
        id: `${tab.id}:${i.identifier}`,
        label: `${i.identifier} ${i.title}`,
        identifier: i.identifier,
        tabId: tab.id,
        scopeLabel,
        hint: i.labels.map((l) => l.name).join(', '),
        state: i.state ? { name: i.state.name, type: i.state.type } : undefined,
      }
      out.push(cand)
    }
  }

  // Notes — skip archived.
  for (const tab of args.tabs) {
    const notes = args.notesByTab[tab.id] ?? []
    const scopeLabel = args.workspaceName(tab.workspaceId)
    for (const n of notes) {
      if (n.archived) continue
      const cand: NoteCandidate = {
        kind: 'note',
        id: `${tab.id}:${n.id}`,
        noteId: n.id,
        label: deriveNoteTitle(n.body),
        tabId: tab.id,
        scopeLabel,
        hint: deriveNoteSnippet(n.body),
      }
      out.push(cand)
    }
  }

  // Tabs — one per open tab.
  for (const tab of args.tabs) {
    const cand: TabCandidate = {
      kind: 'tab',
      id: `tab:${tab.id}`,
      label: args.workspaceName(tab.workspaceId),
      tabId: tab.id,
      scopeLabel: '',
      hint: 'Open tab',
    }
    out.push(cand)
  }

  return out
}
