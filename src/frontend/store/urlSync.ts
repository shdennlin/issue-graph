// Bidirectional URL ↔ store sync. PRD §6.7 codec.

import { useEffect } from 'react'
import { useViewStore, type ViewId, type ThemeMode, type Density } from './viewStore'
import type { IssueStateType } from '@shared/types.js'

const STATE_TYPES: IssueStateType[] = ['backlog', 'unstarted', 'started', 'completed', 'canceled', 'triage']

function csv(arr: string[] | number[]): string | null {
  if (!arr || arr.length === 0) return null
  return arr.join(',')
}

function buildUrl(): string {
  const s = useViewStore.getState()
  const params = new URLSearchParams()
  if (s.activeView !== 'dependency') params.set('view', s.activeView)
  if (s.focusedId) params.set('focus', s.focusedId)
  if (s.theme !== 'auto') params.set('theme', s.theme)
  if (s.density !== 'default') params.set('density', s.density)

  if (!s.filters.activeOnly) params.set('active', '0')
  if (s.filters.myIssuesOnly) params.set('mine', '1')
  if (s.filters.staleOnly) params.set('stale', '1')
  const states = csv(s.filters.stateTypes)
  if (states) params.set('state', states)
  const primaries = csv(s.filters.primaryValues)
  if (primaries) params.set('bucket', primaries)
  const types = csv(s.filters.typeValues)
  if (types) params.set('type', types)
  const prios = csv(s.filters.priorities)
  if (prios) params.set('priority', prios)
  const asg = csv(s.filters.assignees)
  if (asg) params.set('assignee', asg)
  for (const [token, ids] of Object.entries(s.filters.prefixSelections)) {
    if (ids.length) params.set(`pfx_${token}`, ids.join(','))
  }
  if (s.filters.tagIds.length) params.set('tag', s.filters.tagIds.join(','))
  if (s.filters.designdocFilter !== 'all') params.set('designdoc', s.filters.designdocFilter)
  if (s.expandedBuckets.length) params.set('expand', s.expandedBuckets.join(','))

  const qs = params.toString()
  return qs ? `?${qs}` : window.location.pathname
}

let pending: number | undefined
function schedulePush(): void {
  if (pending) window.clearTimeout(pending)
  pending = window.setTimeout(() => {
    const url = buildUrl()
    window.history.replaceState({}, '', url)
  }, 200)
}

function parseUrl(): void {
  const params = new URLSearchParams(window.location.search)
  const set = useViewStore.setState
  const get = useViewStore.getState

  const view = params.get('view') as ViewId | null
  if (view) set({ activeView: view })

  const focus = params.get('focus')
  if (focus) set({ focusedId: focus })

  const theme = params.get('theme') as ThemeMode | null
  if (theme) set({ theme })

  const density = params.get('density') as Density | null
  if (density) set({ density })

  const filters = { ...get().filters }
  if (params.get('active') === '0') filters.activeOnly = false
  if (params.get('mine') === '1') filters.myIssuesOnly = true
  if (params.get('stale') === '1') filters.staleOnly = true

  const state = params.get('state')
  if (state) filters.stateTypes = state.split(',').filter((s): s is IssueStateType => STATE_TYPES.includes(s as IssueStateType))

  const bucket = params.get('bucket')
  if (bucket) filters.primaryValues = bucket.split(',')

  const type = params.get('type')
  if (type) filters.typeValues = type.split(',')

  const priority = params.get('priority')
  if (priority) filters.priorities = priority.split(',').map(Number).filter((n) => !isNaN(n))

  const assignee = params.get('assignee')
  if (assignee) filters.assignees = assignee.split(',')

  const tag = params.get('tag')
  if (tag) filters.tagIds = tag.split(',')

  const dd = params.get('designdoc') as 'all' | 'has' | 'missing' | null
  if (dd) filters.designdocFilter = dd

  for (const [k, v] of params.entries()) {
    if (k.startsWith('pfx_')) {
      const token = k.slice(4)
      filters.prefixSelections = { ...filters.prefixSelections, [token]: v.split(',') }
    }
  }

  const expand = params.get('expand')
  if (expand) set({ expandedBuckets: expand.split(',') })

  set({ filters })
}

export function useUrlSync(): void {
  useEffect(() => {
    parseUrl()
    const unsub = useViewStore.subscribe(() => schedulePush())
    return () => unsub()
  }, [])
}
