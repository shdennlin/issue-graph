# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Runtime & commands

This project uses **Bun** as its JavaScript runtime and package manager. `npm` is intentionally avoided except in the opt-in Node-runtime Dockerfile section of `docs/PRD.md`. Use `bun` for everything else.

```bash
bun install
bun run dev          # concurrent backend (port 31415) + Vite (31414, proxies /api → 31415)
bun run typecheck    # runs tsc against tsconfig.server.json AND tsconfig.web.json
bun run lint
bun run test         # vitest run (all suites)
bun run build        # vite build → dist/  +  tsc -p tsconfig.server.json → build/
```

Run a single test file or pattern (vitest is invoked directly):

```bash
bun x vitest run src/frontend/views/filters.test.ts
bun x vitest run -t "overdue partition"   # by test name
```

`bun run typecheck` is two separate `tsc` invocations because server (`src/backend`, `src/shared`) and web (`src/frontend`, `src/shared`) have different lib/target needs. When changes span both layers, expect to see both run.

Docker for production-shaped runs: `docker compose up -d --build`, then open the app and add a workspace through the setup form. `.env` is optional now — it carries only the settings the server needs before it can open a database (see `.env.example`), and `docker-compose.yml` already pins `PORT` and `SQLITE_PATH`. CI (`.github/workflows/ci.yml`) installs with `bun install --frozen-lockfile` and runs typecheck → lint → test → build → docker build.

## Architecture in one screen

```
src/
  shared/types.ts         Single source of truth for the wire/data contract
                          (NormalizedIssue, GraphData, WorkflowState, IssueStateType, …).
                          Both backend and frontend import via the @shared/* path alias.
  backend/                Hono server + Bun-native SQLite cache (bun:sqlite).
    index.ts              Wires routes, mounts static dist/, installs the per-request
                          workspace middleware (see "Workspace isolation" below).
    sources/              Pluggable backend adapter. v1 = Linear only.
      types.ts            BackendAdapter interface — implement this to add Jira/Plane/etc.
      factory.ts          Caches one adapter per workspace id.
    designdoc/            Pluggable scanner for Spectra/OpenSpec design docs.
                          watcher.ts emits SSE → frontend refetches without a full sync.
    routes/               One file per /api/* resource. Read these to see the contract.
    sync.ts, cache.ts     Pull-from-Linear → normalize → SQLite cache.
    db.ts                 bun:sqlite Database + inline MIGRATIONS array. Adding a column
                          means appending a CREATE TABLE / ALTER TABLE statement here.
    controlStore.ts       PURE roster logic (rows in, resolved config out). Tested.
    controlDb.ts          The bun:sqlite half: data/workspaces.db. Untestable under
                          vitest by construction — keep it thin, no logic. Covered by
                          controlDb.smoke.ts via `bun run test:smoke`.
  frontend/               React 18 + Vite + React Flow + dagre, no SSR.
    App.tsx               Lazy-loads heavy modals (DetailPanel, Notes, SettingsPage, …).
    store/                Zustand stores split by concern:
                            viewStore     UI + filters + view + chain root + density + …
                            graphStore    Server data + sync status + lazy project detail
                            workspaceStore Tabs (per-tab filters/view/viewport)
                            notesStore    Workspace notes
                            schemaStore   Auto-detected label schema
                            urlSync.ts    Bidirectional URL ↔ store sync (significant
                                          vs. preference changes — push vs. replace history)
                            tabStateStore Per-tab persistence in localStorage
    views/                Pure graph builders: (data, filters, ctx) → React Flow nodes/edges.
                          Each view (dependency / mix / project / milestone / designdoc)
                          implements ViewDefinition from views/types.ts.
                          Chain mode (chainRootId !== null) is layered on top: container
                          views delegate to dependencyView.build via chainLayout.ts so
                          chains render consistently regardless of the outer view.
    components/           Presentational + interaction. nodes/ is the per-card UI;
                          notes/, quickSwitcher/, facets/ are feature folders.
      facets/             The filter panel. facetModel.ts is pure derivation (which
                          facets exist, their options, which chips to draw) and holds
                          the tests; the JSX is a thin shell, because vitest runs
                          `environment: 'node'` with no DOM and React components in
                          this repo cannot be tested at all. Mutation goes through
                          viewStore's toggle actions, which carry semantics that are
                          not a function of `Filters` alone.
    i18n/                 en + zh-TW. Locale dicts are typed; DictKey is derived from
                          the English dict shape so missing translations surface as
                          type errors, not runtime fallthroughs.
```

Path aliases (`@shared/*`, `@backend/*`, `@frontend/*`) are defined in the root `tsconfig.json` and mirrored in `vite.config.ts`.

### Data flow for issues

`Linear GraphQL → src/backend/sources/linear/queries.ts → linear/normalize.ts → NormalizedIssue (src/shared/types.ts) → SQLite (cache.ts) → GET /api/graph → graphStore → views/* → React Flow`.

**Adding a new issue field** is a three-layer change: extend the GraphQL query, map it in `normalize.ts`, add the optional field to `NormalizedIssue` in `src/shared/types.ts`. Forgetting any layer means the field reaches the cache as `undefined`. Tests live beside each layer (`normalize.test.ts`, etc.).

### Workspace isolation

Single-binary multi-tenant. `src/backend/lib/workspaceContext.ts` exposes an AsyncLocalStorage scope; the `/api/*` middleware in `index.ts` resolves `?w=<id>` (or the default) and runs the rest of the handler chain inside `runWithWorkspace(wid, …)`. Downstream `loadConfig()`, `getDb()`, `getBackend()`, `runDesignDocScan()` all call `getCurrentWorkspaceId()` — there is no per-route plumbing. Each workspace gets its own SQLite file under `data/workspaces/<id>/graph.db`. When the roster is empty, `UNCONFIGURED_WORKSPACE_ID` keeps every cache keyed consistently while the frontend shows the onboarding form.

**Two SQLite stores, and the difference matters.** `data/workspaces.db` (the control plane) holds the roster: names, API keys, webhook secrets, and the active selection. `data/workspaces/<id>/graph.db` is a *rebuildable cache* — deleting one and re-syncing is a normal troubleshooting step. **Credentials therefore never go in `graph.db`.** The workspace id is a slug that derives the cache path, so re-adding a previously removed id re-adopts its data; that slug reaches the filesystem, so `isValidWorkspaceId()` in `controlStore.ts` is a traversal guard, not a formatting preference.

**`lib/env.ts` must never import `controlDb.ts`.** The roster is injected via `setRosterSource()`, wired as the first statement of `createApp()`. Two reasons: `controlDb.ts` imports `bun:sqlite`, which would break every test that transitively reaches `getLogger()`; and `loadConfig()` caches on first use, so resolving once before the roster is wired pins the process to "unconfigured" for its lifetime.

**After changing a workspace's credentials**, call `invalidateWorkspaceConfig(wid)` *and* `resetBackendCache(wid)` (see `applyWorkspaceEdit` in `routes/workspaces.ts`). `bustDefaultWorkspaceCache()` deliberately does not clear `configByWorkspaceId`, so without both the change does not take effect until restart.

### URL is the source of truth

`urlSync.ts` (see header comment for the two-mode history strategy) encodes view, every filter, focus, chain, search, and workspace into the URL. "Significant" changes push a history entry (Cmd+[/Cmd+] navigate them); preference changes (theme, density, expanded buckets) only replace. When adding a new filter or view-level piece of state that users should be able to share via link, extend three things in `urlSync.ts`: the serializer, the deserializer, and the `significantSignature` (so Back/Forward treats it as a step).

### Memoization is manual — React Compiler is NOT enabled

An earlier version of this file claimed the compiler was on and that manual
`useMemo` / `useCallback` should never be added. That was wrong, and acting on it
would strip real memoization from hot paths. Verified: `babel-plugin-react-compiler`
appears in neither `package.json` nor `bun.lock`, `vite.config.ts` calls `react()`
with no options, and no `react-compiler` ESLint rule is configured. The ~36 manual
memos across `src/frontend/components/` are all load-bearing.

So: memoize by hand where it pays — `GraphCanvas.tsx` (node/edge derivation runs on
every hover and pan) and `facets/useFilterCounts.ts` (five leave-one-out passes over
every issue, recomputed on each filter toggle) are the ones that matter. That hook is
where `FilterPanel.tsx` used to be; it was extracted verbatim precisely so the memos
survived the move to the chip bar. Keep dependency arrays honest; `eslint-plugin-react-hooks` is enabled
and its `exhaustive-deps` warnings are real in both directions, including a
*spurious* dep that makes a memo recompute for nothing.

## Stack notes that bite

- `bun:sqlite` is required — `better-sqlite3` was removed (Bun refuses to load its N-API binding; see `src/backend/db.ts` header). The previous `Dockerfile.node` no longer works against this code path. Backend code only runs on Bun now; the surface of the API stays Node-compatible via `@hono/node-server`.
- TypeScript is strict with `noUncheckedIndexedAccess`. Destructuring `parts[0]` from a `string[]` is `string | undefined`. Plan for that.
- Vitest runs in Node (not Bun). `vitest.config.ts` sets `environment: 'node'` for **every** suite — there is no per-suite override, and `happy-dom` is an installed but unconfigured devDependency. No `bun:test`. Consequence: `src/backend/db.ts` imports `bun:sqlite`, a specifier Node cannot resolve, so **no test can transitively import `db.ts`**. That is why `routes/webhooks.test.ts` mocks `../cache.js` — the mock exists to sever that import edge, not to simplify the test. Any new module that touches SQLite needs the same treatment: keep the `bun:sqlite` layer thin and put the logic in a pure module that takes rows.
- `eslint-plugin-react-hooks` v7's full preset is enabled (not just `rules-of-hooks` + `exhaustive-deps`) — it will flag set-state-in-effect, ref purity, etc. Treat its warnings as real.

## Conventions

- Tests are co-located beside source as `*.test.ts` / `*.test.tsx`. Grep for the existing nearest test before adding a new one.
- **Two filter defaults are not neutral, and they break the unwritten "empty means unfiltered" assumption everywhere.** `Filters.activeOnly` starts `true` (hiding completed + canceled) and `Filters.stateTypes` starts as four of the six types. Six separate defects came from code that reasoned "at default ⇒ not filtering": a State chip pinned to the bar forever, `state=` being the one URL param written at its default, an Active-only checkbox that ticked when switched off, a panel claiming nothing was filtered while a third of the state space was hidden, and a clear button that "restored the default" and so cleared nothing. When touching filter state, ask whether the field *constrains*, not whether it *differs from its default* — they are opposite for these two.
- Migrations are append-only entries in the `MIGRATIONS` array in `src/backend/db.ts` (per-workspace schema) or `CONTROL_MIGRATIONS` in `src/backend/controlDb.ts` (the roster). Never edit a past entry — write a new ALTER.
- User-overridable settings go in `SETTING_SPECS` (`src/backend/lib/settingSpecs.ts`), which owns the bounds *and* the `stored > env > default` precedence; read them via `settingInt()`. Do not hand-wire a reader against the `setting` table — that pattern is how eight of nine settings ended up accepted, validated, stored, and then ignored. A setting with no consumer should not be in the registry at all.
- The shared type module is the contract: changing `src/shared/types.ts` will propagate type errors to both sides; that's the intended signal.
- Auth is intentionally absent — this is a localhost-only / Tailscale-style tool. Don't add CSRF/JWT/etc. unless the user explicitly asks; see the warning block in `README.md`.
- No animations on programmatic scroll/pan unless the user asks. Direct `scrollTop = X` and `rf.setCenter(x, y, { zoom, duration: 0 })` are the house style.

## When in doubt

`docs/PRD.md` is a historical pre-implementation snapshot (2026-05-01) — useful for design rationale (§16 has the decision log) but **not** for current capabilities. For what the app actually does today: `README.md`. For what's planned: `ROADMAP.md`.
