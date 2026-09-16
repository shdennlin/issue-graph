import { describe, expect, it } from 'vitest'
import { hasFilterParams } from './filterCodec'
import { resolveActiveView, translateProtocol, urlCarriesNoAppState } from './urlSync'

// `translateProtocol` turns a `web+issuegraph://` protocol-handler payload into
// the canonical focus query params. The OS routing into the PWA can't be tested
// here; this locks down the pure translation the app performs on arrival.
describe('translateProtocol', () => {
  it('parses workspace + identifier', () => {
    const p = translateProtocol('web+issuegraph://onelegion/ONE-230')
    expect(p).not.toBeNull()
    expect(p?.get('w')).toBe('onelegion')
    expect(p?.get('focus')).toBe('ONE-230')
    expect(p?.get('detail')).toBe('1')
  })

  // The payload used to force `active=0` + all six state types to defeat the
  // non-neutral filter defaults. It must not: carrying no filter param is what
  // makes parseUrl preserve the filters the user already had (hasFilterParams
  // / preserveFiltersOnFocus), and the focused issue stays visible via
  // applyFilters' `alwaysInclude` instead.
  it('carries no filter params', () => {
    const p = translateProtocol('web+issuegraph://onelegion/ONE-230')
    expect(p?.get('active')).toBeNull()
    expect(p?.get('state')).toBeNull()
    expect(hasFilterParams(p!)).toBe(false)
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
    expect(hasFilterParams(p!)).toBe(false)
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

// View resolution for a deep link. The interesting case is a focus link with no
// ?view= (what Raycast emits): on arrival we keep the user's current view, but
// on Back/Forward (popstate) we still reset so history stays consistent.
describe('resolveActiveView', () => {
  it('honors an explicit ?view= regardless of focus/mode', () => {
    expect(resolveActiveView('milestone', false, 'dependency', true)).toBe('milestone')
    expect(resolveActiveView('project', true, 'mix', false)).toBe('project')
  })

  it('keeps the current view for a focus deep link arriving (preserve on)', () => {
    expect(resolveActiveView(null, true, 'milestone', true)).toBe('milestone')
    expect(resolveActiveView(null, true, 'mix', true)).toBe('mix')
  })

  it('resets to the default view on popstate even with a focus (preserve off)', () => {
    expect(resolveActiveView(null, true, 'milestone', false)).toBe('dependency')
  })

  it('resets to the default view when no focus is present', () => {
    expect(resolveActiveView(null, false, 'milestone', true)).toBe('dependency')
  })

  // The default is a per-browser preference now, not the hardcoded
  // 'dependency'. buildUrl omits ?view= for exactly this value, so if the two
  // disagree a bare URL means one view to the writer and another to the
  // reader — Back/Forward would flip the view under you.
  it('falls back to the caller-supplied default rather than a hardcoded view', () => {
    expect(resolveActiveView(null, false, 'milestone', true, 'mix')).toBe('mix')
    expect(resolveActiveView(null, true, 'milestone', false, 'project')).toBe('project')
  })

  it('still lets an explicit ?view= win over the default', () => {
    expect(resolveActiveView('designdoc', false, 'dependency', true, 'mix')).toBe('designdoc')
  })

  it('still preserves the current view for a focus deep link', () => {
    expect(resolveActiveView(null, true, 'milestone', true, 'mix')).toBe('milestone')
  })
})

// A PWA relaunch (Cmd+Q, reopen) lands on the manifest's start_url — `/`, with
// nothing in the query. parseUrl then applies that bare URL wholesale, so every
// filter, the view and the saved-view identity reset to their defaults, and the
// tab forgets where it was. The snapshot is on disk the whole time; nothing
// reads it, because the only first-mount restore was gated on the URL having
// pinned an issue.
//
// This is the predicate that tells those two arrivals apart: "the URL named
// something worth protecting" vs "the URL said nothing at all".
describe('urlCarriesNoAppState', () => {
  const q = (s: string) => new URLSearchParams(s)

  it('says yes for the PWA start_url', () => {
    expect(urlCarriesNoAppState(q(''))).toBe(true)
  })

  // `w` alone still counts as silent: it picks which workspace the tab is on,
  // which the snapshot does not contradict.
  it('says yes when the query only picks a workspace', () => {
    expect(urlCarriesNoAppState(q('w=onelegion'))).toBe(true)
  })

  it.each([
    'state=started',
    'w=onelegion&recent=3h',
    'focus=ONE-243',
    'chain=ONE-243',
    'view=project',
    'q=auth',
    'w=onelegion&detail=1',
  ])('says no for a URL that names something (%s)', (query) => {
    expect(urlCarriesNoAppState(q(query))).toBe(false)
  })

  // The restore must not fire for a shared link, which is the whole reason the
  // first mount skips it in the first place.
  it('says no for a shared link carrying the full filter state', () => {
    expect(urlCarriesNoAppState(q('w=onelegion&view=mix&state=started&priority=1'))).toBe(false)
  })
})
