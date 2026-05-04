import { z } from 'zod'

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

let cached: Config | null = null

export function loadConfig(): Config {
  if (cached) return cached
  const parsed = ConfigSchema.parse(process.env)
  if (parsed.BACKEND === 'linear' && !parsed.LINEAR_API_KEY) {
    // Don't throw — server runs and the onboarding screen tells the user what to do.
    // (Throwing would mean the container can't even start to render onboarding.)
  }
  // REPO_PATH must be absolute so the same value works in `bun run dev` and in
  // `docker compose up` (where it's bind-mounted at the same path inside the
  // container). A relative path silently breaks under Docker.
  if (parsed.REPO_PATH && !parsed.REPO_PATH.startsWith('/')) {
    // eslint-disable-next-line no-console
    console.warn(
      `[issue-graph] REPO_PATH="${parsed.REPO_PATH}" is not absolute. ` +
        `This works for local dev but will break under Docker (bind mounts require absolute paths). ` +
        `Recommended: use an absolute path.`,
    )
  }
  cached = parsed
  return parsed
}

export function isAuthConfigured(cfg: Config): boolean {
  if (cfg.BACKEND === 'linear') return Boolean(cfg.LINEAR_API_KEY)
  return false
}
