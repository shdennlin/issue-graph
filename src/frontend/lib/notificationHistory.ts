// Persistence for the change log, keyed per workspace.
//
// The list used to be memory-only, on the argument that a reloaded "ONE-245 ->
// In Review" describes a state that has since moved on. That argument does not
// hold: each entry is a timestamped record of something that happened, not a
// claim about the present, and the row carries its own clock so it reads as a
// log. What the argument got right was only that the rows need a time on them.
//
// The recency facet is not a substitute either. It answers "which issues were
// touched lately" — it cannot say what about them changed, which is the whole
// question when reviewing what an agent did overnight.
//
// Keyed by workspace, following `pinnedFilters.ts`. Without that, switching
// workspaces would leave one workspace's changes on screen while you look at
// another's — a mild annoyance while it was memory-only, a permanent one once
// it survives reloads.

import type { ChangedField } from './issueDiff'

/** One recorded change. Mirrors the store's entry, and is the wire format on
 *  disk, so widening it needs the validator below to stay in step. */
export interface StoredEntry {
  id: string
  identifier: string
  title: string
  kind: 'created' | 'changed'
  fields: ChangedField[]
  to: Partial<Record<ChangedField, string | null>>
  at: number
  read: boolean
}

/**
 * How many changes to keep per workspace.
 *
 * At roughly a quarter kilobyte each this is ~250KB, against a ~5MB origin
 * budget shared with the tab, workspace and pinned-filter stores. Comfortable,
 * but not so comfortable that the quota guard below is decorative.
 */
export const MAX_ENTRIES = 1000

/** Titles are the only unbounded field, and a long one buys nothing in a
 *  320px popover. Trimmed on the way to disk, not on the way in, so the
 *  in-session row still shows whatever the graph had. */
const MAX_TITLE = 160

const VERSION = 1

interface PersistedShape {
  version: 1
  entries: StoredEntry[]
}

function storageKey(workspaceId: string): string {
  return `ig-notify-log:${workspaceId}`
}

function isEntry(v: unknown): v is StoredEntry {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return (
    typeof o.id === 'string' &&
    typeof o.identifier === 'string' &&
    typeof o.title === 'string' &&
    (o.kind === 'created' || o.kind === 'changed') &&
    Array.isArray(o.fields) &&
    typeof o.at === 'number' &&
    typeof o.read === 'boolean'
  )
}

/** Entries for one workspace, newest first, or `[]` for anything unreadable.
 *  A stored value can outlive the build that wrote it, so an unrecognised
 *  version is discarded rather than guessed at. */
export function readHistory(workspaceId: string | null): StoredEntry[] {
  if (!workspaceId || typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(storageKey(workspaceId))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return []
    const shape = parsed as Partial<PersistedShape>
    if (shape.version !== VERSION || !Array.isArray(shape.entries)) return []
    return shape.entries.filter(isEntry).slice(0, MAX_ENTRIES)
  } catch {
    return []
  }
}

function serialize(entries: StoredEntry[]): string {
  return JSON.stringify({
    version: VERSION,
    entries: entries.map((e) =>
      e.title.length > MAX_TITLE ? { ...e, title: `${e.title.slice(0, MAX_TITLE)}…` } : e,
    ),
  } satisfies PersistedShape)
}

/**
 * Write the log back.
 *
 * On a quota failure the write is retried once with the oldest half dropped,
 * because the alternative is a log that silently stops growing the first time
 * some other key fills the origin up. Losing the tail beats losing the head.
 */
export function writeHistory(workspaceId: string | null, entries: StoredEntry[]): void {
  if (!workspaceId || typeof localStorage === 'undefined') return
  const capped = entries.slice(0, MAX_ENTRIES)
  try {
    localStorage.setItem(storageKey(workspaceId), serialize(capped))
  } catch {
    try {
      localStorage.setItem(
        storageKey(workspaceId),
        serialize(capped.slice(0, Math.floor(capped.length / 2))),
      )
    } catch {
      // Quota or private mode. The in-memory list still works this session.
    }
  }
}

/** Forget one workspace's log. Used by the popover's Clear. */
export function clearHistory(workspaceId: string | null): void {
  if (!workspaceId || typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(storageKey(workspaceId))
  } catch {
    /* nothing to do — the in-memory list is already empty */
  }
}
