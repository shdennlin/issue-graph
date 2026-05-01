import { useEffect, useState } from 'react'
import { useViewStore } from '../store/viewStore'
import { api, type SettingsResponse } from '../lib/api'

export function SettingsPage() {
  const open = useViewStore((s) => s.settingsOpen)
  const close = useViewStore((s) => s.setSettingsOpen)
  const setStaleDays = useViewStore((s) => s.setStaleDays)
  const fontSize = useViewStore((s) => s.fontSize)
  const setFontSize = useViewStore((s) => s.setFontSize)
  const [data, setData] = useState<SettingsResponse | null>(null)
  const [draft, setDraft] = useState<Record<string, unknown>>({})

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

  const importAnnotations = async () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      const text = await file.text()
      const parsed = JSON.parse(text)
      const mode = confirm('Replace existing annotations? (Cancel = merge)') ? 'replace' : 'merge'
      await api.importAnnotations(mode as 'merge' | 'replace', parsed.annotations ?? parsed)
      alert('Imported.')
    }
    input.click()
  }

  const save = async () => {
    if (Object.keys(draft).length === 0) {
      close(false)
      return
    }
    await api.patchSettings(draft)
    if (typeof draft.stale_days_threshold === 'number') setStaleDays(draft.stale_days_threshold)
    close(false)
  }

  const storedStale = stored.stale_days_threshold ? Number(stored.stale_days_threshold) : undefined
  const stale = (draft.stale_days_threshold ?? storedStale ?? env.stale_days) as number

  return (
    <div className="modal-backdrop" onClick={() => close(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>Settings</h3>

        <h4>Display</h4>
        <label style={{ display: 'block', marginBottom: 8 }}>
          Default view{' '}
          <select
            defaultValue={(stored.default_view as string) ?? (env.default_view as string)}
            onChange={(e) => setDraft({ ...draft, default_view: e.target.value })}
          >
            <option value="dependency">Dependency</option>
            <option value="mix">Mix</option>
            <option value="designdoc">Design docs</option>
          </select>
        </label>
        <label style={{ display: 'block', marginBottom: 8 }}>
          Default theme{' '}
          <select
            defaultValue={(stored.default_theme as string) ?? (env.default_theme as string)}
            onChange={(e) => setDraft({ ...draft, default_theme: e.target.value })}
          >
            <option value="auto">Auto</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <label style={{ display: 'block', marginBottom: 8 }}>
          Stale threshold (days){' '}
          <input
            type="number"
            min={1}
            max={365}
            defaultValue={stale}
            onChange={(e) => setDraft({ ...draft, stale_days_threshold: Number(e.target.value) })}
          />
        </label>
        <div style={{ marginBottom: 8 }}>
          <div style={{ marginBottom: 4 }}>Font size</div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {(['sm', 'md', 'lg'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setFontSize(p)}
                className={fontSize === p ? 'primary' : ''}
              >
                {p === 'sm' ? 'Small' : p === 'md' ? 'Medium' : 'Large'}
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
              Custom
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
              title="Base font size in px (9–24). Other sizes derive from this."
            />
          </div>
        </div>

        <h4>Backend</h4>
        <div style={{ color: 'var(--fg-muted)', fontSize: 12 }}>
          API key: {(env.linear_api_key_set as boolean) ? '●●●●●●●●●● (set in .env)' : 'not set'}
          <br />
          Team filter: {(env.linear_team_id as string | null) ?? 'all'}
          <br />
          Identified as: {data?.viewer?.displayName ?? 'unknown'}
          <br />
          Issue scope: {env.issue_scope as string}
        </div>

        <h4>Annotations</h4>
        <button onClick={exportAnnotations}>Export to JSON</button>{' '}
        <button onClick={importAnnotations}>Import from JSON…</button>

        <h4>About</h4>
        <div style={{ color: 'var(--fg-muted)', fontSize: 12 }}>
          Instance: {env.instance_label as string}<br />
          Backend: {env.backend as string}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button onClick={() => close(false)}>Cancel</button>
          <button className="primary" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  )
}
