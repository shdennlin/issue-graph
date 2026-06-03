// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ProjectDetail } from '@shared/types.js'

// Mock the API layer so the store's network calls are observable + deterministic.
vi.mock('../lib/api', () => ({
  api: {
    forceSync: vi.fn(async () => ({ ok: true })),
    fetchGraph: vi.fn(async () => ({ fetchedAt: 1, nodes: [], edges: [] })),
    fetchProjectDetail: vi.fn(async (_id: string, _opts?: { fresh?: boolean }) => ({
      data: { id: 'p1', name: 'Refreshed', milestones: [{ id: 'm1', name: 'New milestone' }] } as unknown as ProjectDetail,
    })),
  },
}))

import { useGraphStore, type ProjectDetailCacheEntry } from './graphStore'
import { api } from '../lib/api'

const staleDetail = { id: 'p1', name: 'Stale', milestones: [] } as unknown as ProjectDetail

describe('graphStore.forceSync — refreshes already-opened project/milestone detail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useGraphStore.setState({
      graph: null,
      status: 'idle',
      syncing: false,
      error: null,
      projectDetails: {},
    })
  })

  it('re-fetches each opened project with fresh=1 and replaces the cached detail', async () => {
    // A project panel was opened earlier, so its detail is cached.
    useGraphStore.setState({ projectDetails: { p1: staleDetail } })

    await useGraphStore.getState().forceSync()

    // The force sync must bypass both caches: backend (fresh flag) + frontend (force).
    expect(api.fetchProjectDetail).toHaveBeenCalledWith('p1', { fresh: true })
    expect(useGraphStore.getState().projectDetails.p1).toMatchObject({ name: 'Refreshed' })
  })

  it('does not fetch project detail when no project was opened', async () => {
    await useGraphStore.getState().forceSync()
    expect(api.fetchProjectDetail).not.toHaveBeenCalled()
  })

  it('revalidates an open panel in place without flashing the loading skeleton', async () => {
    useGraphStore.setState({ projectDetails: { p1: staleDetail } })

    // Record every value p1 takes while the forced refresh is in flight.
    const seen: ProjectDetailCacheEntry[] = []
    const unsub = useGraphStore.subscribe((s) => seen.push(s.projectDetails.p1!))
    await useGraphStore.getState().forceSync()
    unsub()

    // It must never drop to the 'loading' sentinel — that would unmount the
    // panel's content and blink. Existing data stays visible until fresh lands.
    expect(seen).not.toContain('loading')
    expect(useGraphStore.getState().projectDetails.p1).toMatchObject({ name: 'Refreshed' })
  })

  it('only refreshes panels showing real data — skips loading/error entries', async () => {
    // p1 is mid-load (a second fetch would duplicate the in-flight one); p2
    // errored (not actually displaying a project); only p3 holds real data.
    useGraphStore.setState({
      projectDetails: { p1: 'loading', p2: 'error', p3: staleDetail },
    })

    await useGraphStore.getState().forceSync()

    expect(api.fetchProjectDetail).toHaveBeenCalledTimes(1)
    expect(api.fetchProjectDetail).toHaveBeenCalledWith('p3', { fresh: true })
  })

  it('keeps stale data when a background revalidation fails (no error flash)', async () => {
    useGraphStore.setState({ projectDetails: { p1: staleDetail } })
    vi.mocked(api.fetchProjectDetail).mockRejectedValueOnce(new Error('network'))

    await useGraphStore.getState().forceSync()

    // A silent refresh that fails must not replace good data with 'error'.
    expect(useGraphStore.getState().projectDetails.p1).toBe(staleDetail)
  })
})
