// The CSRF guard on the roster routes, and nothing else.
//
// This file exists because the guard is an ABSENCE when it breaks: delete the
// line and every test still passes, the app still works, and the only symptom
// is that a page in someone's browser can now rewrite a Linear API key on
// localhost. All four routes were shipped without it.
//
// vi.mock is hoisted above the imports on purpose — `controlDb.js` imports
// `bun:sqlite`, a specifier Node cannot resolve, so the suite would not load at
// all. Everything below the transport layer is mocked away; what is under test
// is which requests reach a handler, not what the handlers then do.
import { describe, it, expect, vi } from 'vitest'

vi.mock('../controlDb.js', () => ({
  ACTIVE_WORKSPACE_KEY: 'active_workspace',
  deleteWorkspace: vi.fn(),
  readWorkspaceRows: () => [
    { id: 'acme', name: 'Acme', linearApiKey: 'k', webhookSecret: null, linearTeamId: null },
  ],
  readControlSetting: () => null,
  upsertWorkspace: vi.fn(),
  writeControlSetting: vi.fn(),
}))
vi.mock('../lib/env.js', () => ({
  bustDefaultWorkspaceCache: vi.fn(),
  getBaseSqlitePath: () => '/tmp/x.db',
  getDefaultWorkspaceId: () => 'acme',
  getWorkspaceInfo: () => ({ profiles: [{ id: 'acme' }], active: { id: 'acme' } }),
  invalidateWorkspaceConfig: vi.fn(),
  loadConfig: () => ({}),
}))
vi.mock('../lib/eventBus.js', () => ({ BUS_EVENT: {}, publish: vi.fn() }))
vi.mock('../lib/log.js', () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))
vi.mock('../lib/workspaceContext.js', () => ({ runWithWorkspace: (_id: string, fn: () => unknown) => fn() }))
vi.mock('../designdoc/watcher.js', () => ({ startDesignDocWatcher: vi.fn(), stopDesignDocWatcher: vi.fn() }))
vi.mock('../sources/factory.js', () => ({ resetBackendCache: vi.fn() }))
vi.mock('../sources/linear/index.js', () => ({ LinearBackend: class {} }))
vi.mock('../lib/credentialCheck.js', () => ({ classifyCredentialFailure: () => null }))

const { workspaceRoutes } = await import('./workspaces.js')

const EVIL = 'https://evil.example'

/** Every request a browser on another origin could make. `host` matters: the
 *  guard compares it against the Origin, so both have to be present for the
 *  comparison to mean anything. */
const cross = (path: string, method: string, body?: unknown) =>
  workspaceRoutes.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: EVIL, Host: 'localhost:31415' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

describe('cross-origin writes to the roster', () => {
  it.each([
    ['creating a workspace', '/api/workspaces', 'POST', { id: 'x', name: 'X', apiKey: 'stolen' }],
    // The one that matters most: this body carries a Linear API key and a
    // webhook secret, and it is a PATCH on an existing row.
    ['rewriting credentials', '/api/workspaces/acme', 'PATCH', { apiKey: 'stolen', webhookSecret: 's' }],
    ['deleting a workspace', '/api/workspaces/acme', 'DELETE', undefined],
    ['switching the active workspace', '/api/workspaces/active', 'POST', { id: 'acme' }],
  ])('refuses %s with 403', async (_label, path, method, body) => {
    const res = await cross(path, method, body)
    expect(res.status).toBe(403)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('origin')
  })
})

describe('what the guard must not break', () => {
  it('allows a request with no Origin at all — curl, and the app itself', async () => {
    // The guard is CSRF protection, not authentication: a caller that is not a
    // browser sends no Origin and must still work, or every script and the
    // Docker healthcheck break.
    const res = await workspaceRoutes.request('/api/workspaces/acme', {
      method: 'DELETE',
      headers: { Host: 'localhost:31415' },
    })
    expect(res.status).not.toBe(403)
  })

  it('allows a same-origin request', async () => {
    const res = await workspaceRoutes.request('/api/workspaces/acme', {
      method: 'DELETE',
      headers: { Origin: 'http://localhost:31415', Host: 'localhost:31415' },
    })
    expect(res.status).not.toBe(403)
  })

  it('leaves the read unguarded, as every other GET in this app is', async () => {
    const res = await workspaceRoutes.request('/api/workspaces', {
      headers: { Origin: EVIL, Host: 'localhost:31415' },
    })
    expect(res.status).toBe(200)
  })
})
