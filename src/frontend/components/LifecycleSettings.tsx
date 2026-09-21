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

import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2, Zap } from 'lucide-react'
import type { LifecycleStageDTO } from '@shared/types'
import { AUTO_FIELDS, isAutoField, normalizeLinkKind } from '@shared/fields.js'
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
  /** Which stage's "add a field" input is open, if any. One at a time — two
   *  open inputs would each need their own draft and neither would be the one
   *  you meant. */
  const [addingFor, setAddingFor] = useState<number | null>(null)
  const [draftField, setDraftField] = useState('')
  /** Which stage's automatic-source picker is open. Same one-at-a-time rule as
   *  the field input, and for the same reason. */
  const [pickingFor, setPickingFor] = useState<number | null>(null)
  /** name -> description, for every field this workspace has defined. */
  const [fields, setFields] = useState<Map<string, string>>(new Map())
  const abandoned = useRef(false)
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
    Promise.all([api.fetchLifecycle(), api.fetchFields()])
      .then(([r, f]) => {
        if (!live) return
        setStages(r.entries)
        setFields(new Map(f.entries.map((e) => [e.name, e.description])))
      })
      .catch(() => live && setError(t('lifecycle.loadFailed')))
    return () => {
      live = false
    }
  }, [t])

  /** Re-read both the editor's own list and the graph, so cards update without
   *  a reload. A failure surfaces rather than leaving a half-applied view. */
  const refresh = async () => {
    const [r, f] = await Promise.all([api.fetchLifecycle(), api.fetchFields()])
    setStages(r.entries)
    setFields(new Map(f.entries.map((e) => [e.name, e.description])))
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

  // `shows` and `fields` answer ONE question between them — what belongs on
  // this stage — and used to be drawn as two headings with two different
  // widgets: seven toggle buttons, then a comma-separated text box. That
  // second difference was pure implementation leak (`shows` validates against
  // a closed list so it became buttons; `fields` is free text so it became an
  // input), and it is why they read as two unrelated settings.
  //
  // Both are chips now. The one difference left is real and stated in the
  // hint: an automatic row can be switched off, a hand-attached name cannot,
  // because an attachment carries its own stage key and always renders.
  const addField = (stage: LifecycleStageDTO, raw: string) => {
    setAddingFor(null)
    setDraftField('')
    // Escape sets this. Without it, the blur that follows tearing the input
    // down would commit the very text Escape was pressed to throw away — and
    // the DOM value is still the old one at that moment, so reading the event
    // cannot tell the two cases apart.
    if (abandoned.current) {
      abandoned.current = false
      return
    }
    const kind = normalizeLinkKind(raw)
    // Silent on a bad name rather than an error: the commonest way to leave
    // this input is to click away from an empty one.
    if (kind === null || stage.fields.includes(kind)) return
    void run(() => api.patchStage(stage.id, { fields: [...stage.fields, kind] }))
  }

  const removeField = (stage: LifecycleStageDTO, field: string) => {
    void run(() => api.patchStage(stage.id, { fields: stage.fields.filter((f) => f !== field) }))
  }

  /** What typing `raw` into this stage's field box will actually do, or '' when
   *  there is nothing worth saying (empty box, or the name is already exactly
   *  what will be stored). */
  const fieldPreview = (stage: LifecycleStageDTO, raw: string): string => {
    const typed = raw.trim()
    if (typed.length === 0) return ''
    const kind = normalizeLinkKind(typed)
    if (kind === null) return t('lifecycle.fieldBadName')
    if (stage.fields.includes(kind)) return t('lifecycle.fieldAlready', { name: kind })
    return kind === typed ? '' : `\u2192 ${kind}`
  }

  /** Every field name any stage expects, deduped, in pipeline order so the
   *  glossary reads in the order you meet the fields. A description with no
   *  stage asking for it is not listed — it stays stored, and reappears the
   *  moment some stage declares that name again. */
  const usedFields = Array.from(new Set(stages.flatMap((s) => s.fields)))

  /** Automatic names this stage does not have yet — the ones the + offers,
   *  because they are exactly the names you cannot invent. */
  const unusedAuto = (stage: LifecycleStageDTO) =>
    AUTO_FIELDS.filter((name) => !stage.fields.includes(name))

  /** Automatic names first, in canonical order, then the rest as declared. A
   *  stable order means a chip does not move when you remove another one. */
  const orderFields = (fields: string[]) => [
    ...AUTO_FIELDS.filter((n) => fields.includes(n)),
    ...fields.filter((n) => !isAutoField(n)),
  ]

  return (
    <div className="lifecycle-settings">
      <p className="settings-hint">{t('lifecycle.hint')}</p>
      {/* Said once, here, rather than under each stage. It explains a rule of
          the editor, not a property of any one stage, and seven copies of it
          was three lines of identical prose between every pair of rows. */}
      <p className="settings-hint">{t('lifecycle.belongsHint')}</p>

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

            <div className="lifecycle-field-label">{t('lifecycle.expectsLabel')}</div>
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

            {/* One heading, two rows. The heading is the question a person
                actually has ("what belongs on this stage"); the rows are the
                two ways an answer gets here. */}
            <div className="lifecycle-field-label">{t('lifecycle.belongsLabel')}</div>

            {/* ONE row. It was two — an "Automatic" row of projections and a
                "By hand" row of expected names — and they were the same
                question asked twice. A name carries its own answer to "can the
                app fill this by itself?", so the chip wears a bolt and nothing
                has to be sorted into a list to say so. */}
            <div className="lifecycle-belongs-row">
              <div className="lifecycle-states">
                {orderFields(stage.fields).map((f) => (
                  <span
                    key={f}
                    className={`lifecycle-field-chip${isAutoField(f) ? ' is-auto' : ''}`}
                    title={isAutoField(f) ? t('lifecycle.autoHint') : t('lifecycle.handHint')}
                  >
                    {isAutoField(f) && <Zap size={11} aria-hidden />}
                    {isAutoField(f) ? t(`lifecycle.field_${f}` as 'lifecycle.field_issue') : f}
                    <button
                      type="button"
                      className="lifecycle-field-x"
                      title={t('lifecycle.fieldRemove')}
                      aria-label={t('lifecycle.fieldRemove')}
                      disabled={busy}
                      onClick={() => removeField(stage, f)}
                    >
                      {'\u00d7'}
                    </button>
                  </span>
                ))}
                {addingFor === stage.id ? (
                  <>
                  <input
                    className="lifecycle-field-new"
                    // Focused on mount: this input exists only because the user
                    // just clicked + to type in it, so landing anywhere else
                    // would be the surprise.
                    autoFocus
                    value={draftField}
                    aria-label={t('lifecycle.fieldAdd')}
                    placeholder={t('lifecycle.fieldsPlaceholder')}
                    onChange={(e) => setDraftField(e.target.value)}
                    onBlur={(e) => addField(stage, e.target.value)}
                    onKeyDown={(e) => {
                      // Enter commits, Escape abandons. Both through blur-free
                      // paths, because the blur handler would otherwise commit
                      // the very text Escape was meant to throw away.
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        addField(stage, draftField)
                      } else if (e.key === 'Escape') {
                        e.preventDefault()
                        abandoned.current = true
                        setDraftField('')
                        setAddingFor(null)
                      }
                    }}
                  />
                  {/* What will actually be stored, while you type.
                      A name is lowercased and hyphenated so that what you
                      declare and what an agent attaches are one field — but it
                      used to happen in silence: you typed "Release Notes",
                      pressed Enter, and a chip reading `release-notes`
                      appeared with nothing saying why. Worse silently: a name
                      that normalises onto one already listed did nothing at
                      all, and a name that is not a slug did nothing at all,
                      and the two were indistinguishable from a broken input. */}
                  {fieldPreview(stage, draftField) && (
                    <span className="lifecycle-field-preview">
                      {fieldPreview(stage, draftField)}
                    </span>
                  )}
                  </>
                ) : (
                  <button
                    type="button"
                    className="lifecycle-state-toggle"
                    title={t('lifecycle.fieldAdd')}
                    aria-label={t('lifecycle.fieldAdd')}
                    disabled={busy}
                    onClick={() => setPickingFor(pickingFor === stage.id ? null : stage.id)}
                  >
                    +
                  </button>
                )}
                {pickingFor === stage.id && addingFor !== stage.id && (
                  // In flow rather than a popover: this editor lives in a
                  // modal, where an absolutely positioned layer is one
                  // `overflow: hidden` away from being invisible — which is
                  // how the attach form got clipped before the side panel
                  // replaced it.
                  //
                  // One picker for both kinds. The automatic names are offered
                  // because they are the ones you cannot invent; the text box
                  // is the same control, for the ones only you know about.
                  <div
                    className="lifecycle-pick"
                    role="group"
                    aria-label={t('lifecycle.fieldAdd')}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') setPickingFor(null)
                    }}
                  >
                    {unusedAuto(stage).map((name) => (
                      <button
                        key={name}
                        type="button"
                        className="lifecycle-state-toggle"
                        title={t('lifecycle.autoHint')}
                        disabled={busy}
                        onClick={() => {
                          setPickingFor(null)
                          addField(stage, name)
                        }}
                      >
                        <Zap size={11} aria-hidden />
                        {t(`lifecycle.field_${name}` as 'lifecycle.field_issue')}
                      </button>
                    ))}
                    <button
                      type="button"
                      className="lifecycle-state-toggle"
                      disabled={busy}
                      onClick={() => {
                        setPickingFor(null)
                        setDraftField('')
                        setAddingFor(stage.id)
                      }}
                    >
                      {t('lifecycle.fieldCustom')}
                    </button>
                  </div>
                )}
              </div>
            </div>


            <div className="lifecycle-stale">
              <label htmlFor={`stale-${stage.id}`}>{t('lifecycle.staleLabel')}</label>
              <input
                id={`stale-${stage.id}`}
                type="number"
                min={0}
                max={3650}
                defaultValue={stage.staleAfterDays ?? ''}
                placeholder={t('lifecycle.staleNever')}
                disabled={busy}
                onBlur={(e) => {
                  const raw = e.target.value.trim()
                  // Blank means "never", which is a real setting and the honest
                  // one for a stage that legitimately runs for weeks.
                  const next = raw === '' ? null : Number(raw)
                  if (next !== null && !Number.isInteger(next)) return
                  if (next === (stage.staleAfterDays ?? null)) return
                  void run(() => api.patchStage(stage.id, { staleAfterDays: next }))
                }}
              />
            </div>
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

      {/* What the names MEAN, once for the workspace.
          The list is derived from what the stages already declare rather than
          typed again — a registry you had to populate by hand would be a
          second place to add a field, and the two would disagree the first
          time somebody added one in only one of them. Here there is nothing
          to keep in step: a name appears because a stage asked for it, and
          all you supply is the sentence. */}
      {usedFields.length > 0 && (
        <div className="lifecycle-glossary">
          <div className="lifecycle-field-label">{t('lifecycle.glossaryLabel')}</div>
          <p className="settings-hint">{t('lifecycle.glossaryHint')}</p>
          {usedFields.map((name) => (
            <div key={name} className="lifecycle-glossary-row">
              <span className="lifecycle-field-chip">{name}</span>
              <input
                defaultValue={fields.get(name) ?? ''}
                placeholder={t('lifecycle.glossaryPlaceholder')}
                aria-label={name}
                disabled={busy}
                onBlur={(e) => {
                  const next = e.target.value.trim().replace(/\s+/g, ' ')
                  if (next === (fields.get(name) ?? '')) return
                  void run(() => api.setFieldDescription(name, next))
                }}
              />
            </div>
          ))}
        </div>
      )}

      {error && <p className="settings-error">{error}</p>}
    </div>
  )
}
