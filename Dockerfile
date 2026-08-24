# Build stage — full deps (vite, tsc, eslint, @types) needed to build.
FROM oven/bun:1 AS builder
WORKDIR /app
# Lockfile is the text-format `bun.lock` (since the npm→bun migration), not
# the legacy binary `bun.lockb`. Glob matches either form.
COPY package.json bun.lock* bun.lockb* ./
RUN bun install --frozen-lockfile || bun install
COPY . .
RUN bun run build

# Production-deps stage — separate `bun install --production` so the runtime
# image doesn't drag in vite/eslint/typescript/@types (~tens of MB of devDeps).
FROM oven/bun:1 AS prod-deps
WORKDIR /app
COPY package.json bun.lock* bun.lockb* ./
RUN bun install --production --frozen-lockfile || bun install --production

# Runtime stage
FROM oven/bun:1-slim
WORKDIR /app
# curl: healthcheck. git: design-doc worktree scanning.
# sqlite3: scripts/backup.sh uses the CLI's .backup command, which snapshots a
# live WAL database safely — the script's own header and the README both say it
# can run in the container, and without this it could not.
RUN apt-get update && apt-get install -y --no-install-recommends curl git sqlite3 && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/build ./build
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/package.json .
# Operational scripts. backup.sh is documented as runnable at
# /app/scripts/backup.sh; it was never copied in, so that path did not exist.
COPY scripts ./scripts
RUN mkdir -p /app/data && chown -R bun:bun /app/data
EXPOSE 31415
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -fsS http://localhost:31415/api/health || exit 1
USER bun
CMD ["bun", "run", "build/backend/index.js"]
