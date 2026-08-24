// Turns an error response body into something worth showing a person.
//
// The routes answer with { error: { code, message } }, and http() used to throw
// that whole JSON blob inside the Error message. The setup form renders the
// message verbatim, so a user with a typo'd API key was shown the envelope
// rather than the sentence written for them.

const MAX_MESSAGE_LENGTH = 300

export interface ApiErrorInfo {
  /** Machine-readable code when the server sent one, for branching in the UI. */
  code: string | null
  message: string
}

export function extractApiError(body: string): ApiErrorInfo {
  const raw = body.trim()
  if (raw.length === 0) return { code: null, message: 'The server returned an error with no details.' }
  try {
    const parsed = JSON.parse(raw) as { error?: { code?: unknown; message?: unknown } }
    const message = parsed?.error?.message
    if (typeof message === 'string' && message.length > 0) {
      const code = parsed.error?.code
      return { code: typeof code === 'string' ? code : null, message: message.slice(0, MAX_MESSAGE_LENGTH) }
    }
  } catch {
    // Not JSON — an HTML error page or a proxy's plain text. Fall through.
  }
  return { code: null, message: raw.slice(0, MAX_MESSAGE_LENGTH) }
}

/** Carries the status and code so callers can branch without parsing strings. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}
