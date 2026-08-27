import { describe, expect, it } from 'vitest'
import {
  canonicalQuery,
  documentTitle,
  matchSavedView,
  savedViewStatus,
} from './savedViewMatch'

const view = (id: number, query: string) => ({ id, query })

describe('canonicalQuery', () => {
  // The live URL is built in buildUrl's fixed order; a saved query was
  // re-serialized at save time. Same filters, different string.
  it('is order-independent', () => {
    expect(canonicalQuery('view=mix&state=started')).toBe(canonicalQuery('state=started&view=mix'))
  })

  it('tolerates a leading question mark', () => {
    expect(canonicalQuery('?view=mix')).toBe(canonicalQuery('view=mix'))
  })

  // A saved query has already had these stripped server-side while the live
  // URL still carries them, so both sides must drop them to line up.
  it.each(['w=alpha', 'focus=ONE-1', 'detail=1', 'chain=ONE-1', 'note=3', 'notes=1'])(
    'ignores %s',
    (pair) => {
      expect(canonicalQuery(`${pair}&view=mix`)).toBe(canonicalQuery('view=mix'))
    },
  )

  it('does not ignore a real filter', () => {
    expect(canonicalQuery('view=mix&recent=7d')).not.toBe(canonicalQuery('view=mix'))
  })
})

describe('matchSavedView', () => {
  const views = [view(1, 'view=mix&recent=7d'), view(2, 'view=project')]

  it('finds the view matching the current URL despite w= and ordering', () => {
    expect(matchSavedView('?w=alpha&recent=7d&view=mix', views)?.id).toBe(1)
  })

  // Diverging by one filter must stop the match — otherwise the panel keeps
  // claiming a view the user has since edited away from.
  it('stops matching once the state diverges', () => {
    expect(matchSavedView('?w=alpha&view=mix&recent=30d', views)).toBeNull()
  })

  it('returns null when nothing corresponds', () => {
    expect(matchSavedView('?view=dependency', views)).toBeNull()
    expect(matchSavedView('?view=mix&recent=7d', [])).toBeNull()
  })

  it('matches a view saved with no filters at all', () => {
    expect(matchSavedView('?w=alpha', [view(3, '')])?.id).toBe(3)
  })
})

describe('savedViewStatus', () => {
  const views = [view(1, 'view=mix&recent=7d'), view(2, 'view=project')]

  it('reports an exact match as clean', () => {
    expect(savedViewStatus('?w=a&view=mix&recent=7d', views, null)).toEqual({
      view: views[0],
      dirty: false,
    })
  })

  // The whole reason appliedId exists: once you edit a filter the URL matches
  // nothing, and "matches nothing" cannot be told apart from "never applied
  // one" without a reference point.
  it('reports divergence from the applied view as dirty', () => {
    const s = savedViewStatus('?w=a&view=mix&recent=30d', views, 1)
    expect(s.view?.id).toBe(1)
    expect(s.dirty).toBe(true)
  })

  it('prefers an exact match over the applied id', () => {
    // Opening someone's link that happens to equal a saved view should name
    // that view, not the one this session applied earlier.
    expect(savedViewStatus('?view=project', views, 1)).toEqual({ view: views[1], dirty: false })
  })

  it('names nothing when no view was applied and none matches', () => {
    expect(savedViewStatus('?view=dependency', views, null)).toEqual({ view: null, dirty: false })
  })

  it('names nothing when the applied view has since been deleted', () => {
    expect(savedViewStatus('?view=dependency', views, 99)).toEqual({ view: null, dirty: false })
  })
})

describe('documentTitle', () => {
  const week = { name: 'This week' }

  it('is just the app name with neither a view nor a workspace', () => {
    expect(documentTitle(null, false, null, 'Issue Graph')).toBe('Issue Graph')
  })

  // Browsers truncate a narrow tab from the END, so the identifying part has
  // to lead and the app name is what gets cut.
  it('leads with the view, then the workspace', () => {
    expect(documentTitle(week, false, 'OneLegion', 'Issue Graph')).toBe(
      'This week · OneLegion — Issue Graph',
    )
  })

  it.each([
    ['view only', week, null, 'This week — Issue Graph'],
    ['workspace only', null, 'OneLegion', 'OneLegion — Issue Graph'],
  ] as [string, { name: string } | null, string | null, string][])(
    'handles %s',
    (_name, view, workspace, expected) => {
      expect(documentTitle(view, false, workspace, 'Issue Graph')).toBe(expected)
    },
  )

  // Agrees with the panel rather than claiming you are still on a clean view.
  it('carries the dirty marker', () => {
    expect(documentTitle(week, true, 'OneLegion', 'Issue Graph')).toBe(
      'This week * · OneLegion — Issue Graph',
    )
  })
})
