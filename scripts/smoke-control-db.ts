#!/usr/bin/env bun
// Smoke test for the control plane, run under Bun rather than vitest.
//
// controlDb.ts imports `bun:sqlite`, a specifier Node cannot resolve, and
// vitest runs on Node (vitest.config.ts sets environment: 'node' for every
// suite). So that file is structurally unreachable from `bun run test` — see
// the note in CLAUDE.md. Without this script its only verification would be
// running the app by hand.
//
// Everything worth unit-testing lives in the pure controlStore.ts and is
// covered by controlStore.test.ts. What this checks is the SQLite half:
// migrations apply, the patch-style upsert does not clobber stored secrets,
// and resolution works end to end against a real file.
//
//   bun run test:smoke

import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const dir = mkdtempSync(join(tmpdir(), 'ig-ctl-'))
process.env.SQLITE_PATH = join(dir, 'graph.db')
for (const k of Object.keys(process.env)) if (k.startsWith('WORKSPACE_')) delete process.env[k]

const C = await import('../src/backend/controlDb.ts')
const S = await import('../src/backend/controlStore.ts')

let fails = 0
const check = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
}

check('control db lands beside the base path', C.controlDbPath(), join(dir, 'workspaces.db'))
check('empty roster to start', C.readWorkspaceRows(), [])

C.upsertWorkspace({ id: 'onelegion', name: 'OneLegion', apiKey: 'lin_api_A', teamId: 'T1' })
C.upsertWorkspace({ id: 'verdikra', name: 'Verdikra', apiKey: 'lin_api_B' })
check('two rows stored', C.readWorkspaceRows().length, 2)
check('api key persisted', C.readWorkspaceRows().find(r => r.id === 'onelegion')?.apiKey, 'lin_api_A')

// Patch semantics: the UI shows an empty password box on every save.
C.upsertWorkspace({ id: 'onelegion', name: 'OneLegion Renamed' })
const after = C.readWorkspaceRows().find(r => r.id === 'onelegion')!
check('omitting apiKey keeps the stored secret', after.apiKey, 'lin_api_A')
check('name updated', after.name, 'OneLegion Renamed')

C.upsertWorkspace({ id: 'onelegion', name: 'OneLegion', apiKey: '' })
check('empty string clears the secret', C.readWorkspaceRows().find(r => r.id === 'onelegion')?.apiKey, null)

C.upsertWorkspace({ id: 'onelegion', name: 'OneLegion', apiKey: 'lin_api_A', webhookSecret: 'whsec_1' })
check('webhook secret round-trips via the store helper',
  S.webhookSecretFor(C.readWorkspaceRows(), 'onelegion'), 'whsec_1')

C.writeControlMeta(C.ACTIVE_WORKSPACE_KEY, 'verdikra')
check('active workspace persisted', C.readControlMeta(C.ACTIVE_WORKSPACE_KEY), 'verdikra')

const built = S.buildWorkspaceConfig({
  rows: C.readWorkspaceRows(),
  activeOverride: C.readControlMeta(C.ACTIVE_WORKSPACE_KEY),
  defaultSqlitePath: process.env.SQLITE_PATH!,
})
check('end-to-end active resolution', built.activeProfile?.id, 'verdikra')
check('end-to-end credential resolution', built.values.LINEAR_API_KEY, 'lin_api_B')
check('profiles never carry the key', JSON.stringify(built.profiles).includes('lin_api'), false)

let threw = false
try { C.upsertWorkspace({ id: '../evil', name: 'x' }) } catch { threw = true }
check('invalid slug rejected at write time', threw, true)

check('delete removes the row', C.deleteWorkspace('verdikra'), true)
check('delete is idempotent-ish', C.deleteWorkspace('verdikra'), false)
check('one row left', C.readWorkspaceRows().map(r => r.id), ['onelegion'])

// Reopen to prove the schema persisted rather than living in memory.
C.closeControlDb()
check('rows survive a reopen', C.readWorkspaceRows().map(r => r.id), ['onelegion'])

console.log(fails === 0 ? '\nALL CONTROL-DB CHECKS PASSED' : `\n${fails} CHECK(S) FAILED`)
process.exit(fails === 0 ? 0 : 1)
