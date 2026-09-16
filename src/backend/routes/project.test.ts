import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ProjectDetail } from '@shared/types.js'

// One spy adapter shared across the route; the factory is mocked to return it.
const fetchProjectDetail = vi.fn(
  async (id: string): Promise<ProjectDetail> =>
    ({ id, name: `proj-${id}`, milestones: [] }) as unknown as ProjectDetail,
)

vi.mock('../sources/factory.js', () => ({
  getBackend: () => ({ name: 'fake', fetchProjectDetail }),
}))

import { projectRoutes } from './project.js'

describe('GET /api/projects/:id — cache vs. ?fresh=1', () => {
  beforeEach(() => {
    fetchProjectDetail.mockClear()
  })

  it('serves the second identical request from cache (one adapter call)', async () => {
    await projectRoutes.request('/api/projects/p1')
    await projectRoutes.request('/api/projects/p1')
    expect(fetchProjectDetail).toHaveBeenCalledTimes(1)
  })

  it('?fresh=1 bypasses the cache and re-fetches', async () => {
    await projectRoutes.request('/api/projects/p2')
    await projectRoutes.request('/api/projects/p2?fresh=1')
    expect(fetchProjectDetail).toHaveBeenCalledTimes(2)
  })
})
