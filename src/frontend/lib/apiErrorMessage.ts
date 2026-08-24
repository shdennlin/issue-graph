// Localises route errors by the `code` the server sends.
//
// These strings are rendered straight into the setup form and the workspace
// settings, and the backend writes them in English only. Translating on the
// code keeps locale handling entirely in the frontend, where the dictionaries
// already live — the alternative would be threading an Accept-Language through
// every route for a handful of sentences.
//
// An unrecognised code falls back to the server's own message: better an
// English sentence than a raw dictionary path.

import type { DictKey } from '../i18n'

const BY_CODE: Record<string, DictKey> = {
  invalid: 'apiError.invalid',
  invalid_id: 'apiError.invalidId',
  exists: 'apiError.exists',
  key_rejected: 'apiError.keyRejected',
  key_rejected_unchanged: 'apiError.keyRejectedUnchanged',
  not_found: 'apiError.notFound',
  unconfigured: 'apiError.unconfigured',
  switch_in_progress: 'apiError.switchInProgress',
  switch_failed: 'apiError.switchFailed',
}

export function apiErrorKey(code: string | null | undefined): DictKey | null {
  if (!code) return null
  return BY_CODE[code] ?? null
}

/** Localised text for an error thrown by `api.*`, falling back to its message. */
export function apiErrorMessage(err: unknown, t: (k: DictKey) => string): string {
  const code = err && typeof err === 'object' && 'code' in err ? (err as { code: unknown }).code : null
  const key = apiErrorKey(typeof code === 'string' ? code : null)
  if (key) return t(key)
  return err instanceof Error ? err.message : String(err)
}
