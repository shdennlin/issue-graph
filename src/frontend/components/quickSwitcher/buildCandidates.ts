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

  // Issues — one pass per tab.
  for (const tab of args.tabs) {
    const isActive = tab.id === args.activeTabId
    const graph = isActive ? args.activeGraph : args.snapshotGraph(tab.id)
    const issues = (graph as any)?.data?.issues as
      | { id: string; identifier: string; title: string; labels: { name: string }[] }[]
      | undefined
    if (!issues) continue
    const scopeLabel = args.workspaceName(tab.workspaceId)
    for (const i of issues) {
      const cand: IssueCandidate = {
        kind: 'issue',
        id: `${tab.id}:${i.identifier}`,
        label: `${i.identifier} ${i.title}`,
        identifier: i.identifier,
        tabId: tab.id,
        scopeLabel,
        hint: i.labels.map((l) => l.name).join(', '),
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
