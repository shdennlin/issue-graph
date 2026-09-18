// Per-workspace lifecycle editor.
//
// An ordered LIST, not a node canvas. The data model is a chain: a stage has
// exactly one successor, and the only "branch" a real pipeline has is going
// backwards, which a list expresses as moving a row up. A node editor would
// cost drag-to-connect, edge validation and cycle detection to express a shape
// that has one legal form. See the revisit trigger in ADR-0002 — a canvas earns
// itself when some workspace's lifecycle genuinely branches, and not before.
//
// Follows WorkspaceSettings.tsx rather than SettingsPage's draft -> PATCH
// batch: direct api calls per action. It differs from WorkspaceSettings in one
// way on purpose — that component finishes with a full page reload, which is
// fine for a rare action, but the lifecycle is edited repeatedly while being
// tuned, so this refetches the graph instead.
//
// All decisions live in lib/lifecycle.ts and the backend's lifecycleStore.ts;
// this file is a shell, because vitest cannot test JSX in this repo.

import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import type { LifecycleStageDTO } from '@shared/types'
import { api } from '../lib/api'
import { useGraphStore } from '../store/graphStore'
import { useSchemaStore } from '../store/schemaStore'
import { useT } from '../i18n'

export function LifecycleSettings() {
  const t = useT()
  const graph = useGraphStore((s) => s.graph)
  const refetchSilent = useGraphStore((s) => s.refetchSilent)
  const [stages, setStages] = useState<LifecycleStageDTO[]>([])
  const [newName, setNewName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Counts WORKSTREAMS on each stage — an issue has no stage of its own.
  const usage = new Map<string, number>()
  for (const w of graph?.data.workstreams ?? []) {
    const k = (w as { stage?: string | null }).stage
    if (k) usage.set(k, (usage.get(k) ?? 0) + 1)
  }
  const workflowStates = useSchemaStore((s) => s.workflowStates)

  // Every state the WORKSPACE has, not every state currently in use.
  //
  // Deriving this from cached issues (which is what it used to do) hides any
  // state nothing happens to sit in right now — "In Review" vanished from the
  // picker whenever no issue was under review, so the two stages that expect it
  // could not be configured at all. A workflow state with nothing in it is
  // exactly the one a pipeline is heading towards.
  //
  // Names from the cache are still folded in, so a state that has since been
  // removed from Linear stays visible while issues still carry it — otherwise a
  // stage would silently reference a name the editor cannot show.
  const stateNames = Array.from(
    new Set([
      ...workflowStates.map((w) => w.name),
      ...(graph?.data.issues ?? []).map((i) => i.state.name),
    ]),
  )
    .filter((n) => n.length > 0)
    .sort()

  useEffect(() => {
    let live = true
    api
      .fetchLifecycle()
      .then((r) => live && setStages(r.entries))
      .catch(() => live && setError(t('lifecycle.loadFailed')))
    return () => {
      live = false
    }
  }, [t])

  /** Re-read both the editor's own list and the graph, so cards update without
   *  a reload. A failure surfaces rather than leaving a half-applied view. */
  const refresh = async () => {
    const r = await api.fetchLifecycle()
    setStages(r.entries)
    await refetchSilent()
  }

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    // Refresh even when the action failed. A rejected write leaves the editor
    // showing what the user tried, not what the server holds, and the next
    // click then acts on a row that may no longer exist.
    try {
      await refresh()
    } catch {
      /* The error from the action above is the more useful one to keep. */
    }
    setBusy(false)
  }

  const add = () => {
    const name = newName.trim()
    if (!name) return
    void run(async () => {
      await api.createStage({ name })
      setNewName('')
    })
  }

  /** Move one row and send the WHOLE resulting key order — the server rejects
   *  a partial list rather than interleaving it with the current one. */
  const move = (index: number, delta: number) => {
    const next = [...stages]
    const target = index + delta
    const a = next[index]
    const b = next[target]
    if (!a || !b) return
    next[index] = b
    next[target] = a
    void run(() => api.reorderStages(next.map((s) => s.key)))
  }

  const toggleState = (stage: LifecycleStageDTO, name: string) => {
    const has = stage.states.some((s) => s.toLowerCase() === name.toLowerCase())
    const states = has
      ? stage.states.filter((s) => s.toLowerCase() !== name.toLowerCase())
      : [...stage.states, name]
    void run(() => api.patchStage(stage.id, { states }))
  }

  return (
    <div className="lifecycle-settings">
      <p className="settings-hint">{t('lifecycle.hint')}</p>

      {stages.length === 0 && <p className="settings-hint">{t('lifecycle.empty')}</p>}

      <ol className="lifecycle-list">
        {stages.map((stage, i) => (
          <li key={stage.id} className="lifecycle-row">
            <div className="lifecycle-row-head">
              <span className="lifecycle-pos">{i + 1}</span>
              <input
                defaultValue={stage.name}
                aria-label={t('lifecycle.stageName')}
                onBlur={(e) => {
                  const name = e.target.value.trim()
                  if (name && name !== stage.name) void run(() => api.patchStage(stage.id, { name }))
                }}
              />
              <input
                defaultValue={stage.nextCommand ?? ''}
                placeholder={t('lifecycle.nextCommandPlaceholder')}
                aria-label={t('lifecycle.nextCommand')}
                onBlur={(e) => {
                  const cmd = e.target.value.trim()
                  if (cmd !== (stage.nextCommand ?? '')) {
                    void run(() => api.patchStage(stage.id, { nextCommand: cmd || null }))
                  }
                }}
              />
              <button disabled={busy || i === 0} onClick={() => move(i, -1)} title={t('lifecycle.moveUp')}>
                <ArrowUp size={14} />
              </button>
              <button
                disabled={busy || i === stages.length - 1}
                onClick={() => move(i, 1)}
                title={t('lifecycle.moveDown')}
              >
                <ArrowDown size={14} />
              </button>
              <button
                disabled={busy}
                onClick={() => void run(() => api.deleteStage(stage.id))}
                title={t('lifecycle.delete')}
              >
                <Trash2 size={14} />
              </button>
            </div>

            <div className="lifecycle-states">
              {stateNames.map((name) => {
                const on = stage.states.some((s) => s.toLowerCase() === name.toLowerCase())
                return (
                  <button
                    key={name}
                    className={`lifecycle-state-toggle${on ? ' is-on' : ''}`}
                    disabled={busy}
                    onClick={() => toggleState(stage, name)}
                  >
                    {name}
                  </button>
                )
              })}
            </div>
            <p className="settings-hint">
              {/* No states selected is a real configuration, not a missing one:
                  it opts the stage out of conflict detection entirely. Saying so
                  stops it reading as an unfinished row. */}
              {stage.states.length === 0
                ? t('lifecycle.constrainsNothing')
                : t('lifecycle.usage').replace('{n}', String(usage.get(stage.key) ?? 0))}
            </p>
          </li>
        ))}
      </ol>

      <div className="settings-control-row">
        <input
          value={newName}
          placeholder={t('lifecycle.newStagePlaceholder')}
          aria-label={t('lifecycle.newStage')}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add()
          }}
        />
        <button disabled={busy || newName.trim().length === 0} onClick={add}>
          <Plus size={14} /> {t('lifecycle.addStage')}
        </button>
      </div>

      {error && <p className="settings-error">{error}</p>}
    </div>
  )
}
