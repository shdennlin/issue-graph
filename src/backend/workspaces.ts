import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface WorkspaceProfile {
  id: string
  name: string
  linearApiKeySet: boolean
  linearTeamId: string | null
  repoPath: string | null
  dbPath: string | null
}

interface InternalWorkspaceProfile extends WorkspaceProfile {
  linearApiKey: string | null
}

export interface WorkspaceConfigInput {
  env: Record<string, string | undefined>
  activeOverride: string | null
  defaultSqlitePath: string
}

export interface WorkspaceConfigResult {
  profiles: WorkspaceProfile[]
  activeProfile: WorkspaceProfile | null
  values: {
    LINEAR_API_KEY?: string
    LINEAR_TEAM_ID?: string
    REPO_PATH?: string
    SQLITE_PATH: string
  }
  // Set when `activeOverride` (from active-workspace.json) names a profile that
  // is no longer defined in the env. The caller is expected to clear the file
  // so the next load doesn't keep emitting the same warning.
  staleOverride: string | null
}

const WORKSPACE_KEY = /^WORKSPACE_(.+)_(NAME|LINEAR_API_KEY|LINEAR_TEAM_ID|REPO_PATH|SQLITE_PATH)$/

// `WORKSPACE_ACTIVE` is the reserved selector env var. A profile named "active"
// would parse as `WORKSPACE_ACTIVE_*` keys and collide visually with the selector.
const RESERVED_PROFILE_IDS = new Set(['active'])
const warnedReservedIds = new Set<string>()

function normalizeId(raw: string): string {
  return raw.toLowerCase()
}

function readProfiles(env: Record<string, string | undefined>, defaultSqlitePath?: string): InternalWorkspaceProfile[] {
  const byId = new Map<string, Partial<InternalWorkspaceProfile> & { id: string }>()

  for (const [key, value] of Object.entries(env)) {
    if (!value) continue
    const match = WORKSPACE_KEY.exec(key)
    if (!match) continue
    const id = normalizeId(match[1]!)
    if (RESERVED_PROFILE_IDS.has(id)) {
      if (!warnedReservedIds.has(id)) {
        warnedReservedIds.add(id)
        console.warn(
          `[issue-graph] Ignoring WORKSPACE_${id.toUpperCase()}_* env vars: "${id}" is reserved (collides with the WORKSPACE_ACTIVE selector). Pick a different profile id.`,
        )
      }
      continue
    }
    const field = match[2]!
    const profile = byId.get(id) ?? { id }
    if (field === 'NAME') profile.name = value
    else if (field === 'LINEAR_API_KEY') {
      profile.linearApiKey = value
      profile.linearApiKeySet = true
    } else if (field === 'LINEAR_TEAM_ID') profile.linearTeamId = value
    else if (field === 'REPO_PATH') profile.repoPath = value
    else if (field === 'SQLITE_PATH') profile.dbPath = value
    byId.set(id, profile)
  }

  const dataDir = defaultSqlitePath ? dirname(defaultSqlitePath) : null
  return [...byId.values()]
    .filter((p) => p.linearApiKey || p.name || p.repoPath || p.linearTeamId || p.dbPath)
    .map((p) => ({
      id: p.id,
      name: p.name ?? p.id,
      linearApiKey: p.linearApiKey ?? null,
      linearApiKeySet: Boolean(p.linearApiKey),
      linearTeamId: p.linearTeamId ?? null,
      repoPath: p.repoPath ?? null,
      dbPath: p.dbPath ?? (dataDir ? join(dataDir, 'workspaces', p.id, 'graph.db') : null),
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

export function listWorkspaceProfiles(
  env: Record<string, string | undefined>,
  defaultSqlitePath?: string,
): WorkspaceProfile[] {
  return readProfiles(env, defaultSqlitePath).map(({ linearApiKey: _linearApiKey, ...profile }) => profile)
}

export function buildWorkspaceConfig(input: WorkspaceConfigInput): WorkspaceConfigResult {
  const profiles = readProfiles(input.env, input.defaultSqlitePath)
  const overrideId = input.activeOverride ? normalizeId(input.activeOverride) : null
  const envActiveId = input.env.WORKSPACE_ACTIVE ? normalizeId(input.env.WORKSPACE_ACTIVE) : null

  // Stale override = a runtime-selected profile id that no longer exists in env.
  // We do NOT silently fall back to profiles[0] — that would activate the wrong
  // tenant. Instead we surface staleOverride to the caller (which clears the
  // file) and treat the request as "no override" so resolution falls through.
  const staleOverride =
    overrideId && !profiles.some((p) => p.id === overrideId) ? overrideId : null
  if (staleOverride) {
    console.warn(
      `[issue-graph] active-workspace.json names profile "${staleOverride}", which is no longer defined. Falling back to default selection.`,
    )
  }

  const effectiveOverride = staleOverride ? null : overrideId
  let activeInternal: InternalWorkspaceProfile | null = null
  if (effectiveOverride) {
    activeInternal = profiles.find((p) => p.id === effectiveOverride) ?? null
  } else if (envActiveId) {
    activeInternal = profiles.find((p) => p.id === envActiveId) ?? null
    if (!activeInternal && profiles.length > 0) {
      console.warn(
        `[issue-graph] WORKSPACE_ACTIVE="${envActiveId}" does not match any defined profile. Falling back to first profile.`,
      )
      activeInternal = profiles[0] ?? null
    }
  } else if (profiles.length > 0) {
    activeInternal = profiles[0] ?? null
  }

  const activeProfile = activeInternal
    ? (({ linearApiKey: _linearApiKey, ...profile }) => profile)(activeInternal)
    : null

  if (!activeInternal) {
    return {
      profiles: listWorkspaceProfiles(input.env, input.defaultSqlitePath),
      activeProfile: null,
      values: {
        LINEAR_API_KEY: input.env.LINEAR_API_KEY,
        LINEAR_TEAM_ID: input.env.LINEAR_TEAM_ID,
        REPO_PATH: input.env.REPO_PATH,
        SQLITE_PATH: input.defaultSqlitePath,
      },
      staleOverride,
    }
  }

  return {
    profiles: listWorkspaceProfiles(input.env, input.defaultSqlitePath),
    activeProfile,
    values: {
      LINEAR_API_KEY: activeInternal.linearApiKey ?? undefined,
      LINEAR_TEAM_ID: activeInternal.linearTeamId ?? undefined,
      REPO_PATH: activeInternal.repoPath ?? input.env.REPO_PATH,
      SQLITE_PATH: activeInternal.dbPath ?? input.defaultSqlitePath,
    },
    staleOverride,
  }
}

export function getActiveWorkspaceFile(defaultSqlitePath: string): string {
  return join(dirname(defaultSqlitePath), 'active-workspace.json')
}

export function readActiveWorkspaceOverride(defaultSqlitePath: string): string | null {
  const file = getActiveWorkspaceFile(defaultSqlitePath)
  if (!existsSync(file)) return null
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as { active?: unknown }
    return typeof parsed.active === 'string' && parsed.active.length > 0 ? normalizeId(parsed.active) : null
  } catch {
    return null
  }
}

export function writeActiveWorkspaceOverride(defaultSqlitePath: string, active: string): void {
  const file = getActiveWorkspaceFile(defaultSqlitePath)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ active: normalizeId(active) }, null, 2) + '\n')
}

export function clearActiveWorkspaceOverride(defaultSqlitePath: string): void {
  const file = getActiveWorkspaceFile(defaultSqlitePath)
  // Best-effort: a missing or unwritable file isn't a hard failure here.
  try {
    rmSync(file, { force: true })
  } catch {
    // Ignore — the next write will overwrite, and the warning has already been logged.
  }
}
