import { z } from 'zod'
import {
  buildWorkspaceConfig,
  clearActiveWorkspaceOverride,
  listWorkspaceProfiles,
  readActiveWorkspaceOverride,
  resolveProfileValuesById,
  type WorkspaceProfile,
} from '../workspaces.js'
import { getCurrentWorkspaceId, LEGACY_WORKSPACE_ID } from './workspaceContext.js'

// Load .env from CWD if present (no-op in production where env comes from Docker).
// Uses Node's built-in loader (≥20.12) — avoids the dotenv dependency.
try {
  process.loadEnvFile?.()
} catch {
  // .env missing — that's fine, fall through to process.env defaults.
}

const truthyBool = z
  .union([z.string(), z.boolean()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())))

const portSchema = z
  .string()
  .optional()
  .transform((v) => (v && v.length > 0 ? parseInt(v, 10) : 31415))

const intDefault = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? parseInt(v, 10) : def))

const strDefault = (def: string) =>
  z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : def))

const optStr = z
  .string()
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined))

const ConfigSchema = z.object({
  // Backend selection
  BACKEND: strDefault('linear'),

  // Linear
  LINEAR_API_KEY: optStr,
  LINEAR_API_ENDPOINT: strDefault('https://api.linear.app/graphql'),
  LINEAR_WORKSPACE: optStr,
  LINEAR_TEAM_ID: optStr,

  // Server
  PORT: portSchema,
  INSTANCE_LABEL: strDefault('personal-local'),
  LOG_LEVEL: strDefault('info'),
  LOG_TO_FILE: z.string().optional().default('false').transform((v) => truthyBool.parse(v)),

  // Server static-serving toggle. Default true (production / docker behavior:
  // backend serves built dist/ at the root). Dev script sets this to false so
  // a stale dist/ doesn't shadow the live Vite dev server.
  SERVE_STATIC: z.string().optional().default('true').transform((v) => truthyBool.parse(v)),

  // Vite dev server port — only consumed by the friendly "use Vite at..."
  // message shown when SERVE_STATIC is off. Mirrors vite.config.ts's default.
  VITE_PORT: intDefault(31414),

  // Storage
  SQLITE_PATH: strDefault('/app/data/graph.db'),
  REPO_PATH: strDefault('/repo'),
  LABEL_SCHEMA_PATH: strDefault('/app/data/label-schema.yaml'),

  // Issue scope
  ISSUE_SCOPE: strDefault('active+recent'),

  // Label schema
  PRIMARY_GROUP: optStr,
  TYPE_GROUP: optStr,
  TYPE_ICONS: optStr,

  // Cache & retention
  CACHE_TTL_SECONDS: intDefault(900),
  DAILY_SNAPSHOT_HOUR: intDefault(2),
  SNAPSHOT_RETENTION_DAYS: intDefault(365),
  SYNC_LOG_RETENTION: strDefault('forever'),

  // Design-doc
  DESIGNDOC_ADAPTER: strDefault('auto'),
  DESIGNDOC_REQUIRED: z.string().optional().default('false').transform((v) => truthyBool.parse(v)),

  // UI defaults
  STALE_DAYS: intDefault(14),
  DEFAULT_VIEW: strDefault('dependency'),
  DEFAULT_THEME: strDefault('auto'),
  NODE_DENSITY: strDefault('default'),
  SHOW_ACTIVE_ONLY_DEFAULT: z
    .string()
    .optional()
    .default('true')
    .transform((v) => truthyBool.parse(v)),
})

export type Config = z.infer<typeof ConfigSchema>
export type ActiveWorkspaceInfo = {
  active: WorkspaceProfile | null
  profiles: WorkspaceProfile[]
}

// Per-workspace Config cache. Keyed by workspace id (or LEGACY_WORKSPACE_ID
// when no profiles are defined). Built lazily on first loadConfig() call for
// each id. Invariants:
//   - Same id → same Config object (downstream Map<id, T> caches stay coherent).
//   - Different ids → independent Configs, no cross-talk.
const configByWorkspaceId: Map<string, Config> = new Map()

// Cached default workspace id — the one used when no AsyncLocalStorage
// context is set (background tasks, server bootstrap) or when a request
// arrives without `?w=`. Re-derived from active-workspace.json + env.
// `bustDefaultWorkspaceCache()` clears this when the override file changes.
let cachedDefaultWid: string | null = null
let cachedWorkspaceInfo: ActiveWorkspaceInfo | null = null

// Base (pre-profile) SQLITE_PATH — needed for active-workspace.json location.
// The override file lives next to the BASE path, NOT next to a profile-resolved
// path (which would route the override into a per-workspace subdir).
let cachedBaseSqlitePath: string | null = null

// Base (pre-profile) config — env-only, identical across workspace ids.
// Cached so resolving N workspace configs doesn't re-run Zod parse N times
// on the same `process.env` snapshot.
let cachedBase: Config | null = null
function parseBaseConfig(): Config {
  if (!cachedBase) cachedBase = ConfigSchema.parse(process.env)
  return cachedBase
}

function ensureBaseSqlitePath(): string {
  if (cachedBaseSqlitePath) return cachedBaseSqlitePath
  cachedBaseSqlitePath = parseBaseConfig().SQLITE_PATH
  return cachedBaseSqlitePath
}

function resolveDefaultWid(): string {
  if (cachedDefaultWid) return cachedDefaultWid
  const base = parseBaseConfig()
  cachedBaseSqlitePath = base.SQLITE_PATH
  const workspace = buildWorkspaceConfig({
    env: process.env as Record<string, string | undefined>,
    activeOverride: readActiveWorkspaceOverride(base.SQLITE_PATH),
    defaultSqlitePath: base.SQLITE_PATH,
  })
  if (workspace.staleOverride) {
    clearActiveWorkspaceOverride(base.SQLITE_PATH)
  }
  cachedWorkspaceInfo = {
    active: workspace.activeProfile,
    profiles: workspace.profiles,
  }
  cachedDefaultWid = workspace.activeProfile?.id ?? LEGACY_WORKSPACE_ID
  return cachedDefaultWid
}

function buildConfigForWid(wid: string): Config {
  const base = parseBaseConfig()
  cachedBaseSqlitePath = base.SQLITE_PATH

  if (wid === LEGACY_WORKSPACE_ID) {
    if (base.REPO_PATH && !base.REPO_PATH.startsWith('/')) {
      console.warn(
        `[issue-graph] REPO_PATH="${base.REPO_PATH}" is not absolute. ` +
          `This works for local dev but will break under Docker (bind mounts require absolute paths). ` +
          `Recommended: use an absolute path.`,
      )
    }
    return base
  }

  const values = resolveProfileValuesById(
    process.env as Record<string, string | undefined>,
    base.SQLITE_PATH,
    wid,
  )
  if (!values) {
    // Unknown wid — fall back to base config rather than throwing. The route
    // layer should have validated wid before reaching here, but a defensive
    // fallback keeps the server alive if it slips through.
    return base
  }
  const parsed: Config = {
    ...base,
    LINEAR_API_KEY: values.LINEAR_API_KEY ?? base.LINEAR_API_KEY,
    LINEAR_TEAM_ID: values.LINEAR_TEAM_ID ?? base.LINEAR_TEAM_ID,
    REPO_PATH: values.REPO_PATH ?? base.REPO_PATH,
    SQLITE_PATH: values.SQLITE_PATH,
  }
  if (parsed.REPO_PATH && !parsed.REPO_PATH.startsWith('/')) {
    console.warn(
      `[issue-graph] REPO_PATH="${parsed.REPO_PATH}" is not absolute. ` +
        `This works for local dev but will break under Docker (bind mounts require absolute paths). ` +
        `Recommended: use an absolute path.`,
    )
  }
  return parsed
}

/**
 * Returns the Config for the current request's workspace (resolved via
 * AsyncLocalStorage), or for the default workspace when no context is set.
 * Cached per workspace id.
 */
export function loadConfig(): Config {
  const wid = getCurrentWorkspaceId() ?? resolveDefaultWid()
  const cached = configByWorkspaceId.get(wid)
  if (cached) return cached
  const built = buildConfigForWid(wid)
  configByWorkspaceId.set(wid, built)
  return built
}

export function isAuthConfigured(cfg: Config): boolean {
  if (cfg.BACKEND === 'linear') return Boolean(cfg.LINEAR_API_KEY)
  return false
}

/**
 * Server's notion of the "default" workspace — what new tabs land on when
 * they have no `?w=` query, and what the watcher follows. Read from
 * active-workspace.json (with WORKSPACE_ACTIVE env / first-profile fallback).
 * Reflects the latest state across the whole process.
 */
export function getWorkspaceInfo(): ActiveWorkspaceInfo {
  if (!cachedWorkspaceInfo) resolveDefaultWid()
  return cachedWorkspaceInfo ?? {
    active: null,
    profiles: listWorkspaceProfiles(process.env as Record<string, string | undefined>),
  }
}

export function getDefaultWorkspaceId(): string {
  return resolveDefaultWid()
}

/**
 * Bust the default-wid cache so the next loadConfig() / getDefaultWorkspaceId()
 * re-reads active-workspace.json. Called after POST /api/workspaces/active
 * writes a new default. Per-wid Config caches stay valid (their values are
 * keyed by wid, which is independent of which one is the default).
 */
export function bustDefaultWorkspaceCache(): void {
  cachedDefaultWid = null
  cachedWorkspaceInfo = null
}

/**
 * Drop ALL per-workspace Config caches. Used by tests; not called from
 * production paths since per-wid caches are stable across the process.
 */
export function resetConfigCache(): void {
  configByWorkspaceId.clear()
  cachedBase = null
  cachedDefaultWid = null
  cachedWorkspaceInfo = null
  cachedBaseSqlitePath = null
}

export function getBaseSqlitePath(): string {
  return ensureBaseSqlitePath()
}
