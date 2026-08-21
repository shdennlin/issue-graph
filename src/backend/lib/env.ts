import { z } from 'zod'
import {
  buildWorkspaceConfig,
  resolveProfileValuesById,
  webhookSecretFor,
  type WorkspaceProfile,
  type WorkspaceRow,
} from '../controlStore.js'
import { getCurrentWorkspaceId, UNCONFIGURED_WORKSPACE_ID } from './workspaceContext.js'

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
  LINEAR_TEAM_ID: optStr,

  // Server
  PORT: portSchema,
  INSTANCE_LABEL: strDefault('personal-local'),
  LOG_LEVEL: strDefault('info'),

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

  // Design-doc
  DESIGNDOC_ADAPTER: strDefault('auto'),

})

export type Config = z.infer<typeof ConfigSchema>
export type ActiveWorkspaceInfo = {
  active: WorkspaceProfile | null
  profiles: WorkspaceProfile[]
}

// Per-workspace Config cache. Keyed by workspace id (or
// UNCONFIGURED_WORKSPACE_ID when the roster is empty). Built lazily on first
// loadConfig() call for each id. Invariants:
//   - Same id → same Config object (downstream Map<id, T> caches stay coherent).
//   - Different ids → independent Configs, no cross-talk.
const configByWorkspaceId: Map<string, Config> = new Map()

// Cached default workspace id — the one used when no AsyncLocalStorage
// context is set (background tasks, server bootstrap) or when a request
// arrives without `?w=`. Re-derived from the roster + stored active id.
// `bustDefaultWorkspaceCache()` clears this when the selection changes.
let cachedDefaultWid: string | null = null
let cachedWorkspaceInfo: ActiveWorkspaceInfo | null = null

// Base (pre-profile) SQLITE_PATH. The control plane lives next to the BASE
// path, NOT next to a profile-resolved path (which would route it into a
// per-workspace subdir the loader never reads from).
let cachedBaseSqlitePath: string | null = null

// ---------------------------------------------------------------------------
// Roster source.
//
// The workspace roster lives in controlDb.ts, which imports `bun:sqlite` — a
// specifier vitest (Node) cannot resolve. Importing it here would break every
// test that transitively reaches loadConfig(), which is most of them via
// getLogger(). So the roster is injected instead, and this module keeps no
// database import at all.
//
// index.ts MUST call setRosterSource() before anything touches loadConfig(),
// or the default workspace caches as "unconfigured" and stays that way.
// ---------------------------------------------------------------------------

export interface RosterSource {
  rows: () => WorkspaceRow[]
  readActive: () => string | null
  clearActive: () => void
}

const EMPTY_ROSTER: RosterSource = {
  rows: () => [],
  readActive: () => null,
  clearActive: () => undefined,
}

let roster: RosterSource = EMPTY_ROSTER
let rosterWired = false

export function setRosterSource(source: RosterSource): void {
  roster = source
  rosterWired = true
  // Anything resolved against the empty default is now wrong.
  cachedDefaultWid = null
  cachedWorkspaceInfo = null
  configByWorkspaceId.clear()
}

/** True once index.ts has wired the real roster. Lets callers tell "no
 *  workspaces configured" apart from "asked too early". */
export function isRosterWired(): boolean {
  return rosterWired
}

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
    rows: roster.rows(),
    activeOverride: roster.readActive(),
    defaultSqlitePath: base.SQLITE_PATH,
  })
  if (workspace.staleOverride) {
    roster.clearActive()
  }
  cachedWorkspaceInfo = {
    active: workspace.activeProfile,
    profiles: workspace.profiles,
  }
  // No workspace configured yet: the sentinel keeps getDb()/getBackend() keyed
  // consistently while the onboarding screen is what the user actually sees.
  cachedDefaultWid = workspace.activeProfile?.id ?? UNCONFIGURED_WORKSPACE_ID
  return cachedDefaultWid
}

function warnIfRelativeRepoPath(repoPath: string | undefined): void {
  if (!repoPath || repoPath.startsWith('/')) return
  console.warn(
    `[issue-graph] REPO_PATH="${repoPath}" is not absolute. ` +
      `This works for local dev but will break under Docker (bind mounts require absolute paths). ` +
      `Recommended: use an absolute path.`,
  )
}

function buildConfigForWid(wid: string): Config {
  const base = parseBaseConfig()
  cachedBaseSqlitePath = base.SQLITE_PATH
  warnIfRelativeRepoPath(base.REPO_PATH)

  if (wid === UNCONFIGURED_WORKSPACE_ID) {
    // Nothing is set up yet. LINEAR_API_KEY is blanked rather than read from
    // env: credentials come from the control plane now, and leaving the env
    // path alive would mean an instance could look configured with no roster
    // entry behind it — exactly the state the onboarding screen exists to
    // resolve.
    return { ...base, LINEAR_API_KEY: undefined, LINEAR_TEAM_ID: undefined }
  }

  const values = resolveProfileValuesById(roster.rows(), base.SQLITE_PATH, wid)
  if (!values) {
    // Unknown wid. Returning base would hand back a config with no credentials
    // pointing at the base DB path, which is the unconfigured state — safer
    // than throwing, and the route layer should have validated wid already.
    return { ...base, LINEAR_API_KEY: undefined, LINEAR_TEAM_ID: undefined }
  }
  return {
    ...base,
    LINEAR_API_KEY: values.LINEAR_API_KEY,
    LINEAR_TEAM_ID: values.LINEAR_TEAM_ID,
    SQLITE_PATH: values.SQLITE_PATH,
  }
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
 * Server's notion of the "default" workspace — what new tabs land on when they
 * have no `?w=` query, and what the watcher follows. Resolved from the roster
 * plus the stored active id, falling back to the first workspace. Reflects the
 * latest state across the whole process.
 */
export function getWorkspaceInfo(): ActiveWorkspaceInfo {
  if (!cachedWorkspaceInfo) resolveDefaultWid()
  return cachedWorkspaceInfo ?? { active: null, profiles: [] }
}

export function getDefaultWorkspaceId(): string {
  return resolveDefaultWid()
}

/**
 * One workspace's webhook secret, read off the roster.
 *
 * Lives here rather than in the webhook route so that route keeps its distance
 * from controlDb.ts: routes/webhooks.ts is covered by a real test suite, and a
 * `bun:sqlite` import anywhere in its graph would break that suite at import
 * time. The secret is a column on a row the roster already holds, so this is a
 * lookup rather than a second store.
 */
export function getWorkspaceSecret(wid: string): string | null {
  return webhookSecretFor(roster.rows(), wid)
}

/**
 * Bust the default-wid cache so the next loadConfig() / getDefaultWorkspaceId()
 * re-reads the stored active id. Called after POST /api/workspaces/active.
 * Per-wid Config caches stay valid: their values are keyed by wid, which is
 * independent of which one is the default.
 */
export function bustDefaultWorkspaceCache(): void {
  cachedDefaultWid = null
  cachedWorkspaceInfo = null
}

/**
 * Drop one workspace's cached Config so the next loadConfig() re-reads it from
 * the roster. Required after an edit to that workspace's credentials —
 * bustDefaultWorkspaceCache() deliberately does NOT clear configByWorkspaceId,
 * so without this a changed API key would not take effect until restart.
 */
export function invalidateWorkspaceConfig(wid: string): void {
  configByWorkspaceId.delete(wid)
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
