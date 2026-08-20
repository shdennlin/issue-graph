import { describe, it, expect } from 'vitest'
import {
  buildWorkspaceConfig,
  isValidWorkspaceId,
  normalizeWorkspaceId,
  resolveProfileValuesById,
  toProfile,
  workspaceDbPath,
  type WorkspaceRow,
} from './controlStore.js'

const BASE = '/data/graph.db'

function row(over: Partial<WorkspaceRow> & { id: string }): WorkspaceRow {
  return {
    name: over.id,
    backend: 'linear',
    apiKey: 'lin_api_secret',
    webhookSecret: null,
    teamId: null,
    sortOrder: 0,
    createdAt: 0,
    ...over,
  }
}

// Ids arrive from a web form and become filesystem path segments
// (data/workspaces/<id>/graph.db). Env-sourced ids were implicitly trusted
// because writing them required shell access; form-sourced ones are not.
describe('isValidWorkspaceId', () => {
  it('accepts lowercase slugs', () => {
    for (const ok of ['onelegion', 'client-a', 'a', 'ws2', 'a-b-c-1']) {
      expect(isValidWorkspaceId(ok), ok).toBe(true)
    }
  })

  it('rejects anything that could escape the data directory', () => {
    for (const bad of ['..', '.', '../etc', 'a/b', 'a\\b', '/abs', 'a/../b', './x']) {
      expect(isValidWorkspaceId(bad), bad).toBe(false)
    }
  })

  it('rejects characters that are not slug characters', () => {
    for (const bad of ['A', 'has space', 'has.dot', 'quote"', "tick'", 'semi;', 'null\0x', 'emoji😀']) {
      expect(isValidWorkspaceId(bad), bad).toBe(false)
    }
  })

  it('rejects empty, leading-dash, and over-long ids', () => {
    expect(isValidWorkspaceId('')).toBe(false)
    expect(isValidWorkspaceId('-lead')).toBe(false)
    expect(isValidWorkspaceId('a'.repeat(65))).toBe(false)
    expect(isValidWorkspaceId('a'.repeat(64))).toBe(true)
  })

  // Carried over from the env implementation, where WORKSPACE_ACTIVE was the
  // selector variable and a profile called "active" collided with it.
  it('rejects the reserved id', () => {
    expect(isValidWorkspaceId('active')).toBe(false)
  })
})

describe('normalizeWorkspaceId', () => {
  it('lowercases and trims', () => {
    expect(normalizeWorkspaceId('  OneLegion ')).toBe('onelegion')
  })
})

describe('workspaceDbPath', () => {
  // The slug determines the data path, which is what lets a user re-add a
  // workspace by name and pick the existing cache back up.
  it('derives the path from the base dir and the id', () => {
    expect(workspaceDbPath(BASE, 'onelegion')).toBe('/data/workspaces/onelegion/graph.db')
  })

  it('refuses to build a path for an invalid id', () => {
    expect(() => workspaceDbPath(BASE, '../evil')).toThrow()
  })
})

describe('toProfile', () => {
  // The profile is what GET /api/workspaces ships. Secrets are reported as
  // booleans and must never appear as values.
  it('reports secrets as set/unset without exposing them', () => {
    const p = toProfile(row({ id: 'ws1', apiKey: 'lin_api_secret', webhookSecret: 'whsec' }), BASE)
    expect(p.linearApiKeySet).toBe(true)
    expect(p.webhookSecretSet).toBe(true)
    expect(JSON.stringify(p)).not.toContain('lin_api_secret')
    expect(JSON.stringify(p)).not.toContain('whsec')
  })

  it('marks an absent key as unset', () => {
    const p = toProfile(row({ id: 'ws1', apiKey: null, webhookSecret: null }), BASE)
    expect(p.linearApiKeySet).toBe(false)
    expect(p.webhookSecretSet).toBe(false)
  })

  it('falls back to the id when no name is stored', () => {
    expect(toProfile(row({ id: 'ws1', name: '' }), BASE).name).toBe('ws1')
  })
})

describe('buildWorkspaceConfig', () => {
  // The behaviour that replaces legacy mode. Previously an empty roster
  // synthesised a profile out of a bare LINEAR_API_KEY env var; now an empty
  // roster means "nothing is configured yet", which is what the onboarding
  // screen keys off. There is no env fallback left to find.
  it('reports no active profile for an empty roster', () => {
    const r = buildWorkspaceConfig({ rows: [], activeOverride: null, defaultSqlitePath: BASE })
    expect(r.profiles).toEqual([])
    expect(r.activeProfile).toBeNull()
    expect(r.values.LINEAR_API_KEY).toBeUndefined()
    expect(r.values.SQLITE_PATH).toBe(BASE)
  })

  it('makes a single workspace active implicitly', () => {
    const r = buildWorkspaceConfig({ rows: [row({ id: 'solo' })], activeOverride: null, defaultSqlitePath: BASE })
    expect(r.activeProfile?.id).toBe('solo')
    expect(r.values.SQLITE_PATH).toBe('/data/workspaces/solo/graph.db')
  })

  it('resolves the active workspace and its credentials', () => {
    const r = buildWorkspaceConfig({
      rows: [row({ id: 'a', apiKey: 'key-a' }), row({ id: 'b', apiKey: 'key-b', teamId: 'team-b' })],
      activeOverride: 'b',
      defaultSqlitePath: BASE,
    })
    expect(r.activeProfile?.id).toBe('b')
    expect(r.values.LINEAR_API_KEY).toBe('key-b')
    expect(r.values.LINEAR_TEAM_ID).toBe('team-b')
    expect(r.values.SQLITE_PATH).toBe('/data/workspaces/b/graph.db')
  })

  // Carried over verbatim in spirit from the env implementation: silently
  // falling back to the first workspace would point the instance at the wrong
  // tenant's data, which is worse than having no active workspace.
  it('surfaces a stale override instead of falling back to the first row', () => {
    const r = buildWorkspaceConfig({
      rows: [row({ id: 'a' }), row({ id: 'b' })],
      activeOverride: 'deleted',
      defaultSqlitePath: BASE,
    })
    expect(r.staleOverride).toBe('deleted')
    expect(r.activeProfile?.id).not.toBe('deleted')
  })

  it('matches the override case-insensitively', () => {
    const r = buildWorkspaceConfig({ rows: [row({ id: 'a' })], activeOverride: 'A', defaultSqlitePath: BASE })
    expect(r.activeProfile?.id).toBe('a')
    expect(r.staleOverride).toBeNull()
  })

  it('orders profiles by sort order, then id', () => {
    const r = buildWorkspaceConfig({
      rows: [row({ id: 'zeta', sortOrder: 0 }), row({ id: 'alpha', sortOrder: 5 }), row({ id: 'beta', sortOrder: 0 })],
      activeOverride: null,
      defaultSqlitePath: BASE,
    })
    expect(r.profiles.map((p) => p.id)).toEqual(['beta', 'zeta', 'alpha'])
  })

  it('never exposes an api key through the profile list', () => {
    const r = buildWorkspaceConfig({
      rows: [row({ id: 'a', apiKey: 'lin_api_secret' })],
      activeOverride: null,
      defaultSqlitePath: BASE,
    })
    expect(JSON.stringify(r.profiles)).not.toContain('lin_api_secret')
  })

  it('drops rows whose stored id is not a valid slug', () => {
    const r = buildWorkspaceConfig({
      rows: [row({ id: 'good' }), row({ id: '../evil' })],
      activeOverride: null,
      defaultSqlitePath: BASE,
    })
    expect(r.profiles.map((p) => p.id)).toEqual(['good'])
  })
})

describe('resolveProfileValuesById', () => {
  const rows = [row({ id: 'a', apiKey: 'key-a' }), row({ id: 'b', apiKey: 'key-b' })]

  it('resolves one workspace without consulting the active selection', () => {
    expect(resolveProfileValuesById(rows, BASE, 'a')).toEqual({
      LINEAR_API_KEY: 'key-a',
      LINEAR_TEAM_ID: undefined,
      SQLITE_PATH: '/data/workspaces/a/graph.db',
    })
  })

  it('is case-insensitive', () => {
    expect(resolveProfileValuesById(rows, BASE, 'A')?.LINEAR_API_KEY).toBe('key-a')
  })

  // Falling back to another workspace's credentials would silently serve the
  // wrong tenant's data under the requested id.
  it('returns null for an unknown id rather than falling back', () => {
    expect(resolveProfileValuesById(rows, BASE, 'nope')).toBeNull()
  })

  it('keeps workspaces isolated from each other', () => {
    expect(resolveProfileValuesById(rows, BASE, 'b')?.LINEAR_API_KEY).toBe('key-b')
  })
})
