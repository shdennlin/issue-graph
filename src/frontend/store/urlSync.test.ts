import { describe, expect, it } from 'vitest'
import { translateProtocol } from './urlSync'

// `translateProtocol` turns a `web+issuegraph://` protocol-handler payload into
// the canonical focus query params. The OS routing into the PWA can't be tested
// here; this locks down the pure translation the app performs on arrival.
describe('translateProtocol', () => {
  const all = 'backlog,unstarted,started,triage,completed,canceled'

  it('parses workspace + identifier', () => {
    const p = translateProtocol('web+issuegraph://onelegion/ONE-230')
    expect(p).not.toBeNull()
    expect(p?.get('w')).toBe('onelegion')
    expect(p?.get('focus')).toBe('ONE-230')
    expect(p?.get('detail')).toBe('1')
    expect(p?.get('active')).toBe('0')
    expect(p?.get('state')).toBe(all)
  })

  it('lowercases the workspace but preserves identifier case', () => {
    const p = translateProtocol('web+issuegraph://OneLegion/ENG-9')
    expect(p?.get('w')).toBe('onelegion')
    expect(p?.get('focus')).toBe('ENG-9')
  })

  it('opens chain mode with ?mode=chain', () => {
    const p = translateProtocol('web+issuegraph://onelegion/ONE-230?mode=chain')
    expect(p?.get('chain')).toBe('ONE-230')
    expect(p?.get('focus')).toBeNull()
    expect(p?.get('detail')).toBeNull()
    expect(p?.get('w')).toBe('onelegion')
    expect(p?.get('state')).toBe(all)
  })

  it('handles a bare identifier with no workspace', () => {
    const p = translateProtocol('web+issuegraph://ONE-1')
    expect(p?.get('w')).toBeNull()
    expect(p?.get('focus')).toBe('ONE-1')
  })

  it('tolerates the scheme without the // authority slashes', () => {
    const p = translateProtocol('web+issuegraph:onelegion/ONE-7')
    expect(p?.get('w')).toBe('onelegion')
    expect(p?.get('focus')).toBe('ONE-7')
  })

  it('rejects a foreign scheme', () => {
    expect(translateProtocol('https://evil.example/ONE-1')).toBeNull()
    expect(translateProtocol('linear://issue/ENG-1')).toBeNull()
  })

  it('rejects an empty payload', () => {
    expect(translateProtocol('web+issuegraph://')).toBeNull()
    expect(translateProtocol('web+issuegraph://onelegion/')).not.toBeNull()
  })
})
