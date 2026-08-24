// Classifies why a credential check failed.
//
// The setup form used to accept any string as an API key: a typo saved fine and
// only showed up as an empty graph once the first sync 401'd. Verifying at
// submit time is only useful if the two failures stay distinct — "Linear
// rejected this key", which the user must fix and should be blocked on, versus
// "we could not reach Linear", which says nothing about the key and must not
// strand someone behind a transient outage.
//
// Pure: no network, no bun:sqlite. The caller performs the request.

import { AuthError } from '../sources/types.js'

export type CredentialFailure = 'rejected' | 'unreachable'

export function classifyCredentialFailure(err: unknown): CredentialFailure {
  if (err instanceof AuthError) return 'rejected'
  // Also match by name. The error crosses a module boundary, and a duplicated
  // class identity (dual instantiation, a bundler edge) would make instanceof
  // fail — falling through to 'unreachable' would then let a bad key save,
  // which is the exact bug this check exists to prevent.
  if (err instanceof Error && err.name === 'AuthError') return 'rejected'
  return 'unreachable'
}
