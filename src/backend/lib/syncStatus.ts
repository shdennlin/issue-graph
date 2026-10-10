// Classifies the most recent sync so the UI can explain an empty graph.
//
// isAuthConfigured() only asks whether an API key is *present*, which is the
// right question for "has this instance been set up" and the wrong one for
// "are these credentials good". A first-time user's likeliest mistake is a
// typo'd key: the workspace saves fine, the sync 401s, and the graph renders
// empty. Without this the only trace was a row in the sync-history modal.

/** null = nothing to report. 'auth' = credentials rejected, which the user can
 *  fix themselves. 'error' = anything else that went wrong. */
export type SyncFailureKind = 'auth' | 'error' | null

export function syncFailureKind(status: string | null | undefined): SyncFailureKind {
  if (!status) return null
  // 'started' is a sync still in flight; reporting it would flash the banner on
  // every refresh.
  if (status === 'success' || status === 'started') return null
  if (status === 'auth_error') return 'auth'
  // Unrecognised statuses fall through to 'error' rather than being ignored: a
  // row can outlive the build that wrote it, and silence is the worse failure.
  return 'error'
}

// ---------------------------------------------------------------------------
// The other half of the same pipeline: error → status string → UI kind.
// `syncStatusForError` writes the row, `syncFailureKind` above reads it back.
// ---------------------------------------------------------------------------

import { AuthError, ForbiddenError, RateLimitError } from '../sources/types.js'

export type SyncFailureStatus = 'auth_error' | 'rate_limited' | 'api_error'

/**
 * What a failed pull gets called in the sync log.
 *
 * Here rather than inline in sync.ts because sync.ts reaches cache.ts → db.ts →
 * `bun:sqlite`, a specifier Node cannot resolve, so nothing importing it can be
 * tested. The decision is the part worth pinning, so the decision lives out here.
 *
 * 403 maps to `auth_error` alongside 401, which is *not* what the write path
 * does with the same error. The two differ because the credential differs: a
 * write carries one person's OAuth token, so "not allowed" is about that issue
 * and must not condemn the token; a sync runs on the workspace's stored API key
 * against the whole workspace, so "not allowed" is a property of the key, and
 * the operator fixes it in the same drawer as a wrong one.
 */
export function syncStatusForError(err: unknown): SyncFailureStatus {
  if (err instanceof AuthError || err instanceof ForbiddenError) return 'auth_error'
  if (err instanceof RateLimitError) return 'rate_limited'
  return 'api_error'
}
