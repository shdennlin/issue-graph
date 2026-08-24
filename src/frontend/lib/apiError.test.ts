import { describe, it, expect } from 'vitest'
import { extractApiError } from './apiError.js'

// Error bodies end up in front of the user — the setup form shows them
// verbatim — so the server's sentence has to survive, not the JSON around it.
describe('extractApiError', () => {
  it('pulls the message out of the standard error envelope', () => {
    const body = JSON.stringify({ error: { code: 'key_rejected', message: 'Linear rejected this API key.' } })
    expect(extractApiError(body)).toEqual({ code: 'key_rejected', message: 'Linear rejected this API key.' })
  })

  it('keeps the message when there is no code', () => {
    expect(extractApiError(JSON.stringify({ error: { message: 'Nope.' } }))).toEqual({
      code: null,
      message: 'Nope.',
    })
  })

  it('falls back to the raw body when it is not the error envelope', () => {
    expect(extractApiError('Internal Server Error')).toEqual({ code: null, message: 'Internal Server Error' })
    expect(extractApiError(JSON.stringify({ oops: 1 }))).toEqual({ code: null, message: '{"oops":1}' })
  })

  it('handles an empty body without producing an empty message', () => {
    expect(extractApiError('').message.length).toBeGreaterThan(0)
    expect(extractApiError('   ').message.length).toBeGreaterThan(0)
  })

  // A stack trace or an HTML error page would otherwise blow out the form.
  it('truncates a very long body', () => {
    const out = extractApiError('x'.repeat(5000))
    expect(out.message.length).toBeLessThanOrEqual(300)
  })
})
