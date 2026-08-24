import { useState } from 'react'
import { api } from '../lib/api'
import { apiErrorMessage } from '../lib/apiErrorMessage'
import { isValidWorkspaceId, slugifyWorkspaceName } from '../lib/workspaceSlug'
import { LOCALES, useLocale, useSetLocale, useT, type Locale } from '../i18n'

export function Onboarding() {
  const t = useT()
  const locale = useLocale()
  const setLocale = useSetLocale()
  const [name, setName] = useState('')
  const [id, setId] = useState('')
  const [idTouched, setIdTouched] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [teamId, setTeamId] = useState('')
  // 'saving' covers the create + key check; 'syncing' covers the first pull,
  // which takes a few seconds against a real workspace. Without the second
  // state the page reloaded straight into a blank canvas with no explanation.
  const [phase, setPhase] = useState<'idle' | 'saving' | 'syncing'>('idle')
  const [error, setError] = useState<string | null>(null)
  const busy = phase !== 'idle'

  const effectiveId = idTouched ? id : slugifyWorkspaceName(name)
  const idValid = isValidWorkspaceId(effectiveId)
  const canSubmit = idValid && apiKey.trim().length > 0 && !busy

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setPhase('saving')
    setError(null)
    try {
      // The server verifies the key before storing it, so a typo comes back as
      // an error here rather than as an empty graph later.
      await api.createWorkspace({
        id: effectiveId,
        name: name.trim() || effectiveId,
        apiKey: apiKey.trim(),
        teamId: teamId.trim() || null,
      })
      // Pull the first batch while the user is still looking at a screen that
      // says so. GET /api/graph runs a blocking first-run sync, and reloading
      // straight away spent those seconds on an empty canvas instead.
      setPhase('syncing')
      await fetch(`/api/graph?w=${encodeURIComponent(effectiveId)}`).catch(() => undefined)
      // Full reload rather than a store update: the workspace store, the tab
      // state and the graph all bootstrap from /api/workspaces, and replaying
      // that sequence by hand is more moving parts than it is worth on a
      // once-per-install path.
      window.location.reload()
    } catch (err) {
      setError(apiErrorMessage(err, t))
      setPhase('idle')
    }
  }

  return (
    <div className="onboarding">
      {/* The locale picker normally lives in Settings, which is unreachable
          from here — this screen renders alone, with no toolbar. The default
          is English and navigator.language is deliberately not consulted, so
          without this control a non-English user has no way to switch until
          they have already created a workspace. */}
      <div className="onboarding-locale">
        <select
          aria-label={t('settings.language')}
          value={locale}
          onChange={(e) => setLocale(e.target.value as Locale)}
        >
          {LOCALES.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
      </div>
      <h1>{t('onboarding.title')}</h1>
      <p>{t('onboarding.notConfigured')}</p>

      <h3>{t('onboarding.stepsHeading')}</h3>
      <ol>
        <li>{t('onboarding.step1')}</li>
        <li>
          {t('onboarding.step2Prefix')}
          <em>{t('onboarding.step2Em')}</em>
        </li>
        <li>{t('onboarding.step3Form')}</li>
      </ol>

      <form className="onboarding-form" onSubmit={submit}>
        <label>
          {t('onboarding.fieldName')}
          <input
            value={name}
            autoFocus
            placeholder={t('onboarding.fieldNamePlaceholder')}
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <label>
          {t('onboarding.fieldId')}
          <input
            value={effectiveId}
            onChange={(e) => {
              setIdTouched(true)
              setId(e.target.value)
            }}
          />
        </label>
        <div className="onboarding-hint">
          {idValid || effectiveId.length === 0 ? t('onboarding.fieldIdHelp') : t('onboarding.fieldIdInvalid')}
        </div>

        <label>
          {t('onboarding.fieldKey')}
          <input
            type="password"
            autoComplete="off"
            value={apiKey}
            placeholder="lin_api_..."
            onChange={(e) => setApiKey(e.target.value)}
          />
        </label>
        <div className="onboarding-hint">{t('onboarding.fieldKeyHelp')}</div>

        <label>
          {t('onboarding.fieldTeam')}
          <input
            value={teamId}
            placeholder={t('onboarding.fieldTeamPlaceholder')}
            onChange={(e) => setTeamId(e.target.value)}
          />
        </label>

        {error && <div className="onboarding-error">{error}</div>}

        <button className="primary" type="submit" disabled={!canSubmit}>
          {phase === 'syncing'
            ? t('onboarding.syncing')
            : phase === 'saving'
              ? t('onboarding.submitting')
              : t('onboarding.submit')}
        </button>
        {phase === 'syncing' && <div className="onboarding-hint">{t('onboarding.syncingHelp')}</div>}
      </form>

      <p style={{ color: 'var(--fg-muted)', fontSize: 12 }}>{t('onboarding.otherBackends')}</p>
    </div>
  )
}
