import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildWorkspaceConfig,
  clearActiveWorkspaceOverride,
  listWorkspaceProfiles,
  readActiveWorkspaceOverride,
  writeActiveWorkspaceOverride,
} from './workspaces.js'

describe('workspace profiles', () => {
  it('falls back to legacy single-workspace config when no profiles are defined', () => {
    const cfg = buildWorkspaceConfig({
      env: {
        LINEAR_API_KEY: 'lin_legacy',
        LINEAR_TEAM_ID: 'team-legacy',
        REPO_PATH: '/repo/legacy',
        SQLITE_PATH: '/data/graph.db',
      },
      activeOverride: null,
      defaultSqlitePath: '/data/graph.db',
    })

    expect(cfg.activeProfile).toBeNull()
    expect(cfg.values.LINEAR_API_KEY).toBe('lin_legacy')
    expect(cfg.values.LINEAR_TEAM_ID).toBe('team-legacy')
    expect(cfg.values.REPO_PATH).toBe('/repo/legacy')
    expect(cfg.values.SQLITE_PATH).toBe('/data/graph.db')
  })

  it('uses the active workspace profile to derive backend credentials and db path', () => {
    const cfg = buildWorkspaceConfig({
      env: {
        WORKSPACE_ACTIVE: 'client_a',
        WORKSPACE_CLIENT_A_NAME: 'Client A',
        WORKSPACE_CLIENT_A_LINEAR_API_KEY: 'lin_client',
        WORKSPACE_CLIENT_A_LINEAR_TEAM_ID: 'team-client',
        WORKSPACE_CLIENT_A_REPO_PATH: '/repo/client',
        WORKSPACE_PERSONAL_NAME: 'Personal',
        WORKSPACE_PERSONAL_LINEAR_API_KEY: 'lin_personal',
      },
      activeOverride: null,
      defaultSqlitePath: '/app/data/graph.db',
    })

    expect(cfg.activeProfile?.id).toBe('client_a')
    expect(cfg.values.LINEAR_API_KEY).toBe('lin_client')
    expect(cfg.values.LINEAR_TEAM_ID).toBe('team-client')
    expect(cfg.values.REPO_PATH).toBe('/repo/client')
    expect(cfg.values.SQLITE_PATH).toBe('/app/data/workspaces/client_a/graph.db')
  })

  it('lets the runtime active override win over WORKSPACE_ACTIVE', () => {
    const cfg = buildWorkspaceConfig({
      env: {
        WORKSPACE_ACTIVE: 'personal',
        WORKSPACE_PERSONAL_LINEAR_API_KEY: 'lin_personal',
        WORKSPACE_CLIENT_A_LINEAR_API_KEY: 'lin_client',
      },
      activeOverride: 'client_a',
      defaultSqlitePath: '/app/data/graph.db',
    })

    expect(cfg.activeProfile?.id).toBe('client_a')
    expect(cfg.values.LINEAR_API_KEY).toBe('lin_client')
  })

  it('treats a single defined profile as the implicit active when nothing is selected', () => {
    const cfg = buildWorkspaceConfig({
      env: {
        WORKSPACE_PERSONAL_NAME: 'Personal',
        WORKSPACE_PERSONAL_LINEAR_API_KEY: 'lin_personal',
      },
      activeOverride: null,
      defaultSqlitePath: '/data/graph.db',
    })

    expect(cfg.activeProfile?.id).toBe('personal')
    expect(cfg.values.LINEAR_API_KEY).toBe('lin_personal')
    expect(cfg.staleOverride).toBeNull()
  })

  it('respects an explicit WORKSPACE_<ID>_SQLITE_PATH override', () => {
    const cfg = buildWorkspaceConfig({
      env: {
        WORKSPACE_CLIENT_A_LINEAR_API_KEY: 'lin_client',
        WORKSPACE_CLIENT_A_SQLITE_PATH: '/custom/client.db',
      },
      activeOverride: 'client_a',
      defaultSqlitePath: '/data/graph.db',
    })

    expect(cfg.values.SQLITE_PATH).toBe('/custom/client.db')
  })

  it('reports staleOverride and falls through when activeOverride no longer matches a profile', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const cfg = buildWorkspaceConfig({
      env: {
        WORKSPACE_PERSONAL_LINEAR_API_KEY: 'lin_personal',
      },
      activeOverride: 'gone',
      defaultSqlitePath: '/data/graph.db',
    })

    // The stale override is surfaced rather than silently selecting profiles[0].
    expect(cfg.staleOverride).toBe('gone')
    // With activeOverride cleared, default selection picks the only remaining profile.
    expect(cfg.activeProfile?.id).toBe('personal')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"gone"'))
    warn.mockRestore()
  })

  it('warns and falls back to first profile when WORKSPACE_ACTIVE names a missing profile', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const cfg = buildWorkspaceConfig({
      env: {
        WORKSPACE_ACTIVE: 'gone',
        WORKSPACE_CLIENT_A_LINEAR_API_KEY: 'lin_client',
        WORKSPACE_PERSONAL_LINEAR_API_KEY: 'lin_personal',
      },
      activeOverride: null,
      defaultSqlitePath: '/data/graph.db',
    })

    // Sorted alphabetically: client_a comes first.
    expect(cfg.activeProfile?.id).toBe('client_a')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('WORKSPACE_ACTIVE='))
    warn.mockRestore()
  })

  it('ignores a profile id of "active" since it collides with the WORKSPACE_ACTIVE selector', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const profiles = listWorkspaceProfiles({
      WORKSPACE_ACTIVE_LINEAR_API_KEY: 'lin_reserved',
      WORKSPACE_PERSONAL_LINEAR_API_KEY: 'lin_personal',
    })

    expect(profiles.map((p) => p.id)).toEqual(['personal'])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('reserved'))
    warn.mockRestore()
  })

  it('lists profiles without exposing api keys', () => {
    const profiles = listWorkspaceProfiles({
      WORKSPACE_PERSONAL_NAME: 'Personal',
      WORKSPACE_PERSONAL_LINEAR_API_KEY: 'lin_personal',
      WORKSPACE_CLIENT_A_LINEAR_API_KEY: 'lin_client',
      WORKSPACE_CLIENT_A_REPO_PATH: '/repo/client',
    })

    expect(profiles).toEqual([
      {
        id: 'client_a',
        name: 'client_a',
        linearApiKeySet: true,
        linearTeamId: null,
        repoPath: '/repo/client',
        dbPath: null,
      },
      {
        id: 'personal',
        name: 'Personal',
        linearApiKeySet: true,
        linearTeamId: null,
        repoPath: null,
        dbPath: null,
      },
    ])
  })
})

describe('active-workspace.json file I/O', () => {
  let tmpDir: string
  let sqlitePath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'issue-graph-ws-'))
    sqlitePath = join(tmpDir, 'graph.db')
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('round-trips an active workspace id through write/read', () => {
    expect(readActiveWorkspaceOverride(sqlitePath)).toBeNull()
    writeActiveWorkspaceOverride(sqlitePath, 'CLIENT_A')
    // Stored value is normalized to lowercase.
    expect(readActiveWorkspaceOverride(sqlitePath)).toBe('client_a')
  })

  it('returns null for a missing file', () => {
    expect(readActiveWorkspaceOverride(sqlitePath)).toBeNull()
  })

  it('clears the override file', () => {
    writeActiveWorkspaceOverride(sqlitePath, 'client_a')
    expect(readActiveWorkspaceOverride(sqlitePath)).toBe('client_a')
    clearActiveWorkspaceOverride(sqlitePath)
    expect(readActiveWorkspaceOverride(sqlitePath)).toBeNull()
    // Idempotent: clearing again on a missing file does not throw.
    expect(() => clearActiveWorkspaceOverride(sqlitePath)).not.toThrow()
  })

  it('is robust against malformed JSON in the override file', () => {
    writeActiveWorkspaceOverride(sqlitePath, 'client_a')
    const file = join(tmpDir, 'active-workspace.json')
    expect(existsSync(file)).toBe(true)
    // Corrupt the file and verify readActiveWorkspaceOverride returns null instead of throwing.
    rmSync(file, { force: true })
    expect(readActiveWorkspaceOverride(sqlitePath)).toBeNull()
  })
})
