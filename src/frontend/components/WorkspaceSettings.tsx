// Workspace roster management. Rendered as a section inside SettingsPage.
//
// Credentials are write-only across the API: the server reports
// `linearApiKeySet` as a boolean and never returns the value, so the key input
// always starts empty. Leaving it empty on save keeps the stored secret —
// the PATCH omits the field entirely rather than sending ''.

import { useState } from 'react'
import { api } from '../lib/api'
import { useWorkspaceStore } from '../store/workspaceStore'
import { isValidWorkspaceId, slugifyWorkspaceName } from '../lib/workspaceSlug'
import { useT } from '../i18n'

export function WorkspaceSettings() {
  const t = useT()
  const profiles = useWorkspaceStore((s) => s.profiles)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [id, setId] = useState('')
  const [idTouched, setIdTouched] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [editKey, setEditKey] = useState('')

  const effectiveId = idTouched ? id : slugifyWorkspaceName(name)
  const canAdd = isValidWorkspaceId(effectiveId) && apiKey.trim().length > 0 && !busy

  // A full reload rather than a store refresh: the roster feeds tab state, the
  // graph and the schema, all of which bootstrap from /api/workspaces. Rare
  // action, and replaying that sequence by hand is more moving parts than it
  // is worth.
  const reload = () => window.location.reload()

  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <div className="workspace-settings">
      <div style={{ color: 'var(--fg-muted)', fontSize: 12, marginBottom: 8 }}>
        {t('settings.workspacesHelp')}
      </div>

      <ul className="workspace-list">
        {profiles.map((p) => (
          <li key={p.id}>
            <div className="workspace-row">
              <span className="workspace-name">{p.name}</span>
              <code className="workspace-id">{p.id}</code>
              <span style={{ color: 'var(--fg-muted)', fontSize: 12 }}>
                {p.linearApiKeySet ? t('settings.wsKeySet') : t('settings.wsKeyMissing')}
              </span>
              <span className="workspace-row-actions">
                <button
                  onClick={() => {
                    setEditing(editing === p.id ? null : p.id)
                    setEditKey('')
                  }}
                >
                  {t('settings.wsReplaceKey')}
                </button>
                <button
                  disabled={busy}
                  onClick={() => {
                    // Removing the roster entry leaves data/workspaces/<id>/
                    // untouched, which is what the confirm text promises.
                    if (!window.confirm(t('settings.wsRemoveConfirm', { name: p.name }))) return
                    void run(() => api.deleteWorkspace(p.id))
                  }}
                >
                  {t('settings.wsRemove')}
                </button>
              </span>
            </div>

            {editing === p.id && (
              <div className="workspace-edit">
                <input
                  type="password"
                  autoComplete="off"
                  placeholder={t('settings.wsNewKeyPlaceholder')}
                  value={editKey}
                  onChange={(e) => setEditKey(e.target.value)}
                />
                <button
                  className="primary"
                  disabled={busy || editKey.trim().length === 0}
                  onClick={() => void run(() => api.updateWorkspace(p.id, { apiKey: editKey.trim() }))}
                >
                  {t('common.save')}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {adding ? (
        <div className="workspace-add">
          <label>
            {t('onboarding.fieldName')}
            <input value={name} autoFocus onChange={(e) => setName(e.target.value)} />
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
          <label>
            {t('onboarding.fieldKey')}
            <input
              type="password"
              autoComplete="off"
              placeholder="lin_api_..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </label>
          <div style={{ color: 'var(--fg-muted)', fontSize: 11 }}>{t('onboarding.fieldIdHelp')}</div>
          <div>
            <button
              className="primary"
              disabled={!canAdd}
              onClick={() =>
                void run(() =>
                  api.createWorkspace({ id: effectiveId, name: name.trim() || effectiveId, apiKey: apiKey.trim() }),
                )
              }
            >
              {busy ? t('onboarding.submitting') : t('onboarding.submit')}
            </button>{' '}
            <button onClick={() => setAdding(false)}>{t('common.cancel')}</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)}>{t('settings.wsAdd')}</button>
      )}

      {error && <div className="onboarding-error">{error}</div>}
    </div>
  )
}
