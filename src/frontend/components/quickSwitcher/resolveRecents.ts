import type { Candidate, RecentItem } from './types'

/**
 * Turn stored recents into rows, using the live candidate wherever there is one.
 *
 * A recent keeps only a label, so a row built from it alone shows a title and
 * nothing else. The live candidate carries state, assignee and the rest — but
 * finding it by `id` fails more often than it looks: the id embeds a tab id
 * (a random UUID), and buildCandidates keeps ONE copy of an issue per workspace,
 * preferring the active tab. A recent saved from another tab, or from a tab
 * since closed, therefore never matched, and only the rows that happened to
 * belong to the current tab got their facts.
 *
 * So match on what identifies the thing — workspace plus identifier / note id —
 * and use the live candidate for the click too, since its tab is one that exists.
 * Several recents can resolve to the same candidate (the same issue opened from
 * two tabs); it is listed once, at its most recent position.
 */
function stableKey(kind: Candidate['kind'], scopeLabel: string, ref: string | number | undefined, id: string): string {
  if (kind === 'tab' || ref === undefined || ref === '') return `id:${id}`
  return `${kind}:${scopeLabel}:${ref}`
}

function candidateKey(c: Candidate): string {
  if (c.kind === 'issue') return stableKey('issue', c.scopeLabel, c.identifier, c.id)
  if (c.kind === 'note') return stableKey('note', c.scopeLabel, c.noteId, c.id)
  return `id:${c.id}`
}

export function resolveRecents(
  recents: RecentItem[],
  candidates: Candidate[],
  fallback: (r: RecentItem) => Candidate,
): Candidate[] {
  const byKey = new Map<string, Candidate>()
  for (const c of candidates) byKey.set(candidateKey(c), c)
  const seen = new Set<string>()
  const out: Candidate[] = []
  for (const r of recents) {
    const live = byKey.get(stableKey(r.kind, r.scopeLabel, r.ref, r.id))
    const c = live ?? fallback(r)
    if (seen.has(c.id)) continue
    seen.add(c.id)
    out.push(c)
  }
  return out
}
