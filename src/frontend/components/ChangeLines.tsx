import { MessageSquare } from 'lucide-react'
import { useLocale, useT } from '../i18n'
import type { StoredEntry } from '../lib/notificationHistory'
import { describeEntry, type LineValue, type Tone } from '../lib/notificationSummary'

/**
 * One line per moved field — "Status  Todo → ● In Review" — shared by the toast
 * and the bell rows so the same change never reads two ways.
 *
 * Colours come from `--change-*` custom properties that fall back to the theme
 * tokens (see `.change-line` in globals.css). The bell sits on the themed
 * surface and takes the fallbacks; the toast is always dark and sets its own.
 */
export function ChangeLines({ entry }: { entry: StoredEntry }) {
  const t = useT()
  const locale = useLocale()
  return (
    <>
      {describeEntry(entry, t, locale).map((line, i) =>
        line.prose ? (
          <span key={i} className="change-line change-line-prose" title={line.to?.text}>
            <MessageSquare size={12} className="change-icon" aria-label={line.label} />
            <span className="change-prose">{line.to?.text}</span>
          </span>
        ) : (
          <span key={i} className="change-line">
            <span className="change-field">{line.label}</span>
            {line.from && <Value v={line.from} old />}
            {line.from && line.to && <span aria-hidden>→</span>}
            {line.to && <Value v={line.to} />}
          </span>
        ),
      )}
    </>
  )
}

const NON_STATE: ReadonlySet<Tone> = new Set<Tone>(['warn', 'danger', 'none'])

/** One side of a change. The old side is struck through and muted whatever its
 *  tone — it is context, and colouring both would compete with the new one. */
function Value({ v, old = false }: { v: LineValue; old?: boolean }) {
  if (old) return <span className="change-old">{v.text}</span>
  // A state carries a dot as well as a colour, so the type still reads for
  // anyone who cannot tell blue from violet.
  const state = v.tone !== undefined && !NON_STATE.has(v.tone)
  return (
    <span className={`change-val${v.tone ? ` tone-${v.tone}` : ''}${state ? ' is-state' : ''}`}>
      {v.text}
    </span>
  )
}
