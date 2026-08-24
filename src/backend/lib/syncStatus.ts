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
