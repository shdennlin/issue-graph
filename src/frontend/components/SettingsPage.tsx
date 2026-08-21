import { useEffect, useState } from 'react'
import { useViewStore } from '../store/viewStore'
import { useSchemaStore } from '../store/schemaStore'
import { api, type SettingsResponse } from '../lib/api'
import { ModalHeader } from './ModalHeader'
import { WorkspaceSettings } from './WorkspaceSettings'
import { readDefaultView, writeDefaultView } from '../lib/preferences'
import type { ThemeMode, ViewId } from '../store/viewStore'
import { LOCALES, useLocale, useSetLocale, useT, type Locale } from '../i18n'

export function SettingsPage() {
  const open = useViewStore((s) => s.settingsOpen)
  const close = useViewStore((s) => s.setSettingsOpen)
  const setStaleDays = useViewStore((s) => s.setStaleDays)
  const staleDays = useViewStore((s) => s.staleDays)
  const theme = useViewStore((s) => s.theme)
  const setTheme = useViewStore((s) => s.setTheme)
  const fontSize = useViewStore((s) => s.fontSize)
  const setFontSize = useViewStore((s) => s.setFontSize)
  const maxColsPerRow = useViewStore((s) => s.maxColsPerRow)
  const setMaxColsPerRow = useViewStore((s) => s.setMaxColsPerRow)
  const locale = useLocale()
  const setLocale = useSetLocale()
  const t = useT()
  const schema = useSchemaStore((s) => s.schema)
  const [data, setData] = useState<SettingsResponse | null>(null)
  const [draft, setDraft] = useState<Record<string, unknown>>({})
  const [resetting, setResetting] = useState(false)
  // Phased progress for the reset flow. Each phase is visible to the user as
  // a labelled step in the blocking overlay so they can see why the screen is
  // frozen instead of guessing whether the app hung.
  type ResetPhase = 'idle' | 'clearing' | 'syncing' | 'done' | 'error'
  const [resetPhase, setResetPhase] = useState<ResetPhase>('idle')
  const [resetMessage, setResetMessage] = useState<string>('')

  useEffect(() => {
    if (!open) return
    api.fetchSettings().then(setData).catch(() => setData(null))
  }, [open])

  if (!open) return null

  const env = data?.env ?? {}
  const stored = data?.stored ?? {}

  const exportAnnotations = async () => {
    const data = await api.exportAnnotations()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `annotations-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
  }

  const resetCache = async () => {
    const ok = confirm(t('settings.confirmReset'))
    if (!ok) return
    setResetting(true)
    try {
      setResetPhase('clearing')
      setResetMessage(t('settings.overlayClearing'))
      const result = await api.resetCache()
      setResetPhase('syncing')
      setResetMessage(t('settings.overlaySyncing'))
      await api.forceSync()
      setResetPhase('done')
      setResetMessage(
        t('settings.overlayDoneMsg', { issues: result.cleared.issues, labels: result.cleared.labels }),
      )
      // Hard-reload so every store re-initializes from the fresh cache. This
      // avoids stale labels / filters / focusedIds left over from the previous
      // workspace's data being silently re-applied to the new graph.
      window.setTimeout(() => window.location.reload(), 800)
    } catch (err) {
      setResetPhase('error')
      setResetMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setResetting(false)
    }
  }

  const importAnnotations = async () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      const text = await file.text()
      const parsed = JSON.parse(text)
      const mode = confirm(t('settings.importMergePrompt')) ? 'replace' : 'merge'
      await api.importAnnotations(mode as 'merge' | 'replace', parsed.annotations ?? parsed)
      alert(t('settings.importedAlert'))
    }
    input.click()
  }

  const save = async () => {
    if (Object.keys(draft).length === 0) {
      close(false)
      return
    }
    await api.patchSettings(draft)
    close(false)
  }

  const storedTtl = stored.cache_ttl_seconds ? Number(stored.cache_ttl_seconds) : undefined
  const cacheTtl = (draft.cache_ttl_seconds ?? storedTtl ?? env.cache_ttl_seconds) as number

  const overlay = resetPhase !== 'idle' && (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(0, 0, 0, 0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      // Block clicks so the user can't dismiss / interact during the reset.
      onClick={(e) => e.stopPropagation()}
    >
      <div
        style={{
          background: 'var(--bg-elev, #fff)',
          color: 'var(--fg)',
          padding: '24px 28px',
          borderRadius: 10,
          minWidth: 320,
          maxWidth: 480,
          boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
          textAlign: 'center',
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 'var(--fs-base)' }}>
          {resetPhase === 'clearing' && t('settings.overlayResetting')}
          {resetPhase === 'syncing' && t('settings.overlaySyncTitle')}
          {resetPhase === 'done' && t('settings.overlayDone')}
          {resetPhase === 'error' && t('settings.overlayError')}
        </div>
        {/* Indeterminate progress bar — shows motion so user knows we're alive. */}
        {(resetPhase === 'clearing' || resetPhase === 'syncing') && (
          <div
            style={{
              height: 4,
              background: 'var(--node-border, #d0d7de)',
              borderRadius: 2,
              overflow: 'hidden',
              marginBottom: 12,
            }}
          >
            <div
              style={{
                height: '100%',
                width: '40%',
                background: 'var(--accent, #2563eb)',
                animation: 'reset-bar 1.2s ease-in-out infinite',
              }}
            />
          </div>
        )}
        <div style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-meta)' }}>{resetMessage}</div>
        {resetPhase === 'error' && (
          <button onClick={() => setResetPhase('idle')} style={{ marginTop: 14 }}>
            {t('common.dismiss')}
          </button>
        )}
      </div>
      <style>{`
        @keyframes reset-bar {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(350%); }
        }
      `}</style>
    </div>
  )

  return (
    <>
      {overlay}
      <div className="modal-backdrop" onClick={() => close(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <ModalHeader title={t('settings.title')} onClose={() => close(false)} />
        <div className="settings-body">

        <h4>{t('settings.display')}</h4>
        {/* These three apply immediately to this browser rather than going
            through draft -> PATCH. They are personal preferences, and as server
            settings they both clobbered other people on a shared instance and
            silently reverted on reload because nothing applied them at boot. */}
        <label style={{ display: 'block', marginBottom: 8 }}>
          {t('settings.defaultView')}{' '}
          <select
            defaultValue={readDefaultView()}
            onChange={(e) => writeDefaultView(e.target.value as ViewId)}
          >
            <option value="dependency">{t('views.dependency.label')}</option>
            <option value="mix">{t('views.mix.label')}</option>
            <option value="project">{t('views.project.label')}</option>
            <option value="milestone">{t('views.milestone.label')}</option>
            <option value="designdoc">{t('views.designdoc.label')}</option>
          </select>
        </label>
        <label style={{ display: 'block', marginBottom: 8 }}>
          {t('settings.defaultTheme')}{' '}
          <select
            defaultValue={theme}
            onChange={(e) => setTheme(e.target.value as ThemeMode)}
          >
            <option value="auto">{t('settings.themeAuto')}</option>
            <option value="light">{t('settings.themeLight')}</option>
            <option value="dark">{t('settings.themeDark')}</option>
          </select>
        </label>
        <label style={{ display: 'block', marginBottom: 8 }}>
          {t('settings.staleThreshold')}{' '}
          <input
            type="number"
            min={1}
            max={365}
            defaultValue={staleDays}
            onChange={(e) => {
              const n = Number(e.target.value)
              if (Number.isInteger(n) && n >= 1 && n <= 365) setStaleDays(n)
            }}
          />
        </label>
        <div style={{ marginBottom: 8 }}>
          <div style={{ marginBottom: 4 }}>{t('settings.fontSize')}</div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {(['sm', 'md', 'lg'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setFontSize(p)}
                className={fontSize === p ? 'primary' : ''}
              >
                {p === 'sm' ? t('settings.fontSm') : p === 'md' ? t('settings.fontMd') : t('settings.fontLg')}
              </button>
            ))}
            {/* "Custom" indicator: highlights as primary when fontSize is a
                numeric override so user sees at-a-glance which mode is active.
                Shows the live px value next to it. */}
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--node-border)',
                background: typeof fontSize === 'number' ? 'var(--accent)' : 'var(--bg-elev)',
                color: typeof fontSize === 'number' ? 'var(--accent-fg)' : 'var(--fg)',
                fontSize: 'var(--fs-base)',
              }}
            >
              {t('settings.fontCustom')}
              {typeof fontSize === 'number' && (
                <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fontSize}px</span>
              )}
            </span>
            {/* Always show the resolved px in the input — even when a preset
                is active — so the user can see what "Medium" actually is. */}
            <input
              type="number"
              min={9}
              max={24}
              step={1}
              value={
                typeof fontSize === 'number'
                  ? fontSize
                  : fontSize === 'sm' ? 12 : fontSize === 'lg' ? 15 : 13
              }
              onChange={(e) => {
                const v = e.target.value
                if (v === '') return
                const n = Number(v)
                if (Number.isFinite(n) && n >= 9 && n <= 24) setFontSize(n)
              }}
              style={{ width: 70 }}
              title={t('settings.fontHelp')}
            />
          </div>
        </div>

        <div style={{ marginBottom: 8 }}>
          <div style={{ marginBottom: 4 }}>{t('settings.issuesPerRow')}</div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {[2, 3, 4, 5, 6, 7, 8].map((n) => (
              <button
                key={n}
                onClick={() => setMaxColsPerRow(n)}
                className={maxColsPerRow === n ? 'primary' : ''}
                style={{ minWidth: 32 }}
              >
                {n}
              </button>
            ))}
            <span style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-meta)', marginLeft: 8 }}>
              {t('settings.issuesPerRowHelp')}
            </span>
          </div>
        </div>

        <h4>{t('settings.language')}</h4>
        <label style={{ display: 'block', marginBottom: 8 }}>
          {t('settings.language')}{' '}
          <select
            value={locale}
            onChange={(e) => setLocale(e.target.value as Locale)}
          >
            {LOCALES.map((l) => (
              <option key={l.id} value={l.id}>{l.label}</option>
            ))}
          </select>
        </label>

        <h4>{t('settings.backend')}</h4>
        <div style={{ color: 'var(--fg-muted)', fontSize: 12 }}>
          {t('settings.profile')}{' '}
          {data?.workspace?.active ? (
            <>
              {data.workspace.active.name} <code>({data.workspace.active.id})</code>
            </>
          ) : (
            t('settings.legacyEnv')
          )}
          <br />
          {t('settings.workspace')}{' '}
          {data?.viewer?.organization ? (
            <>
              {data.viewer.organization.name} (
              <a
                href={`https://linear.app/${data.viewer.organization.urlKey}/`}
                target="_blank"
                rel="noreferrer"
                title="Open this workspace in Linear"
              >
                {data.viewer.organization.urlKey}
              </a>
              )
            </>
          ) : (
            t('settings.unknownResync')
          )}
          <br />
          {t('settings.apiKey')} {(env.linear_api_key_set as boolean) ? t('settings.apiKeySet') : t('settings.apiKeyUnset')}
          <br />
          {t('settings.teamFilter')} {(env.linear_team_id as string | null) ?? t('settings.teamAll')}
          {data?.workspace?.active?.dbPath && (
            <>
              <br />
              {t('settings.db')} <code>{data.workspace.active.dbPath}</code>
            </>
          )}
          <br />
          {t('settings.identifiedAs')} {data?.viewer?.displayName ?? t('settings.unknownUser')}
          <br />
          {t('settings.issueScope')} {env.issue_scope as string}
          <br />
          {t('settings.bucketGroup')}{' '}
          {schema.primaryGroup ? (
            <>
              <code>{schema.primaryGroup}</code>{' '}
              {(env.label_schema_loaded as boolean | undefined)
                ? t('settings.schemaSourceYaml')
                : env.primary_group_override
                  ? t('settings.schemaSourceEnv', { var: 'PRIMARY_GROUP' })
                  : t('settings.schemaSourceAuto')}
            </>
          ) : (
            t('settings.schemaSourceNone')
          )}
          <br />
          {t('settings.typeGroup')}{' '}
          {schema.typeGroup ? (
            <>
              <code>{schema.typeGroup}</code>{' '}
              {(env.label_schema_loaded as boolean | undefined)
                ? t('settings.schemaSourceYaml')
                : env.type_group_override
                  ? t('settings.schemaSourceEnv', { var: 'TYPE_GROUP' })
                  : t('settings.schemaSourceAuto')}
            </>
          ) : (
            t('common.none')
          )}
          {(env.label_schema_path as string | undefined) && (
            <>
              <br />
              {t('settings.labelSchemaPath')}{' '}
              <code>{env.label_schema_path as string}</code>{' '}
              {(env.label_schema_loaded as boolean | undefined)
                ? t('settings.labelSchemaLoaded')
                : t('settings.labelSchemaAbsent')}
            </>
          )}
        </div>
        <label style={{ display: 'block', marginTop: 10, marginBottom: 8 }}>
          {t('settings.cacheTtl')}{' '}
          <input
            type="number"
            min={10}
            max={86400}
            defaultValue={cacheTtl}
            onChange={(e) => setDraft({ ...draft, cache_ttl_seconds: Number(e.target.value) })}
            title={t('settings.cacheTtlHelp')}
            style={{ width: 100 }}
          />
          <span style={{ color: 'var(--fg-muted)', fontSize: 11, marginLeft: 8 }}>
            {t('settings.cacheTtlSuffix', { minutes: Math.round(cacheTtl / 60) })}
          </span>
        </label>
        <div style={{ marginTop: 10 }}>
          <button onClick={resetCache} disabled={resetting} title={t('settings.resetButtonTitle')}>
            {resetting ? t('settings.resetting') : t('settings.resetButton')}
          </button>
          <div style={{ color: 'var(--fg-muted)', fontSize: 11, marginTop: 4 }}>
            {t('settings.resetHelp')}
          </div>
        </div>

        <h4>{t('settings.workspaces')}</h4>
        <WorkspaceSettings />

        <h4>{t('settings.annotations')}</h4>
        <button onClick={exportAnnotations}>{t('settings.exportJson')}</button>{' '}
        <button onClick={importAnnotations}>{t('settings.importJson')}</button>

        <h4>{t('settings.about')}</h4>
        <div style={{ color: 'var(--fg-muted)', fontSize: 12 }}>
          {t('settings.backendValue', { value: env.backend as string })}
        </div>

        </div>
        <h4>{t('settings.webhook')}</h4>
        <div style={{ color: 'var(--fg-muted)', fontSize: 12, marginBottom: 6 }}>
          {t('settings.webhookHelp')}
        </div>
        <label>
          {t('settings.webhookSecret')}{' '}
          <input
            type="password"
            autoComplete="off"
            placeholder={
              data?.webhook?.secret_set ? t('settings.webhookSecretSet') : t('settings.webhookSecretUnset')
            }
            onChange={(e) => setDraft({ ...draft, linear_webhook_secret: e.target.value })}
          />
        </label>
        <div style={{ color: 'var(--fg-muted)', fontSize: 12, marginTop: 6 }}>
          {/* Status matters more than it looks: a webhook that stops arriving
              fails silently — the graph just quietly goes stale. These counters
              are the only way to notice. */}
          {data?.webhook ? (
            <>
              {t('settings.webhookAccepted', {
                count: data.webhook.ok_count,
                when: data.webhook.last_ok_ms
                  ? new Date(data.webhook.last_ok_ms).toLocaleString()
                  : t('settings.webhookNever'),
              })}
              <br />
              {t('settings.webhookRejected', {
                count: data.webhook.reject_count,
                reason: data.webhook.last_reject_reason ?? '—',
              })}
            </>
          ) : (
            t('settings.webhookNever')
          )}
        </div>

        <div className="settings-footer">
          <button onClick={() => close(false)}>{t('common.cancel')}</button>
          <button className="primary" onClick={save}>{t('common.save')}</button>
        </div>
      </div>
    </div>
    </>
  )
}
