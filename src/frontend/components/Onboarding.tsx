import { useState } from 'react'
import { api } from '../lib/api'
import { isValidWorkspaceId, slugifyWorkspaceName } from '../lib/workspaceSlug'
import { useT } from '../i18n'

export function Onboarding() {
  const t = useT()
  const [name, setName] = useState('')
  const [id, setId] = useState('')
  const [idTouched, setIdTouched] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [teamId, setTeamId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const effectiveId = idTouched ? id : slugifyWorkspaceName(name)
  const idValid = isValidWorkspaceId(effectiveId)
  const canSubmit = idValid && apiKey.trim().length > 0 && !busy

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    try {
      await api.createWorkspace({
        id: effectiveId,
        name: name.trim() || effectiveId,
        apiKey: apiKey.trim(),
        teamId: teamId.trim() || null,
      })
      // Full reload rather than a store update: the workspace store, the tab
      // state and the graph all bootstrap from /api/workspaces, and replaying
      // that sequence by hand is more moving parts than it is worth on a
      // once-per-install path.
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <div className="onboarding">
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
          {busy ? t('onboarding.submitting') : t('onboarding.submit')}
        </button>
      </form>

      <p style={{ color: 'var(--fg-muted)', fontSize: 12 }}>{t('onboarding.otherBackends')}</p>
    </div>
  )
}
