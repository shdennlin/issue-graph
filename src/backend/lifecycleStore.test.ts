import { describe, it, expect } from 'vitest'
import {
  KEY_MAX,
  NAME_MAX,
  NEXT_COMMAND_MAX,
  STATES_MAX,
  isKeyTaken,
  isNameTaken,
  lifecycleRowToDTO,
  nextSortOrder,
  normalizeNextCommand,
  normalizeStageKey,
  normalizeStageName,
  normalizeStates,
  parseStates,
  reorderStages,
  slugifyStageName,
  stageVerdict,
  fallbackStageKey,
} from './lifecycleStore.js'

describe('normalizeStageKey', () => {
  it('accepts a slug and lowercases it', () => {
    expect(normalizeStageKey('Review-Spec')).toBe('review-spec')
    expect(normalizeStageKey('  impl  ')).toBe('impl')
  })

  it('rejects non-slug shapes', () => {
    expect(normalizeStageKey('review spec')).toBeNull()
    expect(normalizeStageKey('review_spec')).toBeNull()
    expect(normalizeStageKey('-leading')).toBeNull()
    expect(normalizeStageKey('trailing-')).toBeNull()
    expect(normalizeStageKey('double--hyphen')).toBeNull()
  })

  it('rejects empty, over-long and non-string input', () => {
    expect(normalizeStageKey('')).toBeNull()
    expect(normalizeStageKey('   ')).toBeNull()
    expect(normalizeStageKey('a'.repeat(KEY_MAX + 1))).toBeNull()
    expect(normalizeStageKey(42)).toBeNull()
    expect(normalizeStageKey(null)).toBeNull()
  })
})

describe('slugifyStageName', () => {
  it('derives a key from a display name', () => {
    expect(slugifyStageName('Review Spec')).toBe('review-spec')
    expect(slugifyStageName('Waiting on CI!')).toBe('waiting-on-ci')
  })

  it('never emits a leading or trailing hyphen, even after truncation', () => {
    // The slice to KEY_MAX can land on a separator; the result must still be a
    // key normalizeStageKey would accept, or the editor produces a stage it
    // cannot then save.
    const name = `${'a'.repeat(KEY_MAX - 1)} tail`
    const slug = slugifyStageName(name)
    expect(slug).not.toBeNull()
    expect(normalizeStageKey(slug)).toBe(slug)
  })

  it('returns null when nothing survives', () => {
    // Includes any non-Latin script — this app ships a zh-TW locale, so a stage
    // named only in Chinese is ordinary. The route falls back rather than
    // refusing the stage; see fallbackStageKey.
    expect(slugifyStageName('!!!')).toBeNull()
    expect(slugifyStageName('   ')).toBeNull()
    expect(slugifyStageName('審查規格')).toBeNull()
  })
})

describe('fallbackStageKey', () => {
  it('starts at stage-1', () => {
    expect(fallbackStageKey([])).toBe('stage-1')
  })

  it('skips keys already in use', () => {
    expect(fallbackStageKey(['stage-1', 'stage-2'])).toBe('stage-3')
  })

  it('reuses a gap left by a deleted stage', () => {
    // A plain count+1 would collide the first time a stage is removed.
    expect(fallbackStageKey(['stage-1', 'stage-3'])).toBe('stage-2')
  })

  it('produces a key normalizeStageKey accepts', () => {
    expect(normalizeStageKey(fallbackStageKey([]))).toBe('stage-1')
  })
})

describe('normalizeStageName', () => {
  it('trims and keeps case', () => {
    expect(normalizeStageName('  Review Spec ')).toBe('Review Spec')
  })

  it('rejects empty, over-long and non-string input', () => {
    expect(normalizeStageName('')).toBeNull()
    expect(normalizeStageName('x'.repeat(NAME_MAX + 1))).toBeNull()
    expect(normalizeStageName(undefined)).toBeNull()
  })
})

describe('normalizeStates', () => {
  it('keeps the names as typed, in order', () => {
    expect(normalizeStates(['In Review', 'Review Spec'])).toEqual(['In Review', 'Review Spec'])
  })

  it('treats an empty list as valid, not as an error', () => {
    // An empty list means "this stage does not constrain the Linear state", so
    // it must round-trip rather than being rejected as missing input.
    expect(normalizeStates([])).toEqual([])
    expect(normalizeStates(null)).toEqual([])
    expect(normalizeStates(undefined)).toEqual([])
  })

  it('drops blanks and case-insensitive duplicates, keeping the first spelling', () => {
    expect(normalizeStates(['In Review', '  ', 'in review', 'IN REVIEW'])).toEqual(['In Review'])
  })

  it('rejects a non-array, a non-string member, an over-long name and an over-long list', () => {
    expect(normalizeStates('In Review')).toBeNull()
    expect(normalizeStates([1])).toBeNull()
    expect(normalizeStates(['x'.repeat(NAME_MAX + 1)])).toBeNull()
    expect(normalizeStates(new Array(STATES_MAX + 1).fill('x'))).toBeNull()
  })
})

describe('normalizeNextCommand', () => {
  it('collapses absent and empty to null', () => {
    expect(normalizeNextCommand(null)).toBeNull()
    expect(normalizeNextCommand(undefined)).toBeNull()
    expect(normalizeNextCommand('   ')).toBeNull()
  })

  it('trims a real command', () => {
    expect(normalizeNextCommand('  /spectra-apply  ')).toBe('/spectra-apply')
  })

  it('signals invalid input as undefined, distinct from a valid null', () => {
    // null means "no next step" and is stored; undefined means "reject this
    // request". Collapsing them would silently clear a command on bad input.
    expect(normalizeNextCommand(42)).toBeUndefined()
    expect(normalizeNextCommand('x'.repeat(NEXT_COMMAND_MAX + 1))).toBeUndefined()
  })
})

describe('parseStates', () => {
  it('parses a stored array', () => {
    expect(parseStates('["In Review"]')).toEqual(['In Review'])
  })

  it('degrades a malformed or wrong-typed column to an empty list', () => {
    // A hand-edited bad row must not be able to throw inside the graph
    // response and take down every issue.
    expect(parseStates('not json')).toEqual([])
    expect(parseStates('{"a":1}')).toEqual([])
    expect(parseStates('[1,"In Review",null]')).toEqual(['In Review'])
  })
})

describe('row → DTO', () => {
  it('maps a lifecycle row', () => {
    expect(
      lifecycleRowToDTO({
        id: 1,
        key: 'impl',
        name: 'Implementing',
        sort_order: 2,
        states: '["In Progress"]',
        next_command: '/spectra-apply',
        fields: '["pr"]',
        stale_after_days: 3,
        created_at: 10,
        updated_at: 20,
      }),
    ).toEqual({
      id: 1,
      key: 'impl',
      name: 'Implementing',
      sortOrder: 2,
      states: ['In Progress'],
      nextCommand: '/spectra-apply',
      fields: ['pr'],
      staleAfterDays: 3,
      createdAt: 10,
      updatedAt: 20,
    })
  })

})

describe('nextSortOrder', () => {
  it('appends after the highest existing order', () => {
    expect(nextSortOrder([{ sort_order: 0 }, { sort_order: 3 }])).toBe(4)
  })

  it('starts at 0 when there are no stages', () => {
    expect(nextSortOrder([])).toBe(0)
  })
})

describe('isKeyTaken', () => {
  const rows = [
    { id: 1, key: 'impl' },
    { id: 2, key: 'review' },
  ]

  it('detects a collision', () => {
    expect(isKeyTaken(rows, 'impl')).toBe(true)
    expect(isKeyTaken(rows, 'done')).toBe(false)
  })

  it('lets a row keep its own key on PATCH', () => {
    expect(isKeyTaken(rows, 'impl', 1)).toBe(false)
    expect(isKeyTaken(rows, 'impl', 2)).toBe(true)
  })
})

describe('isNameTaken', () => {
  const rows = [
    { id: 1, name: 'Implementing' },
    { id: 2, name: 'In Review' },
  ]

  it('matches case-insensitively and ignoring surrounding space', () => {
    // Two stages a reader cannot tell apart are the same stage.
    expect(isNameTaken(rows, 'implementing')).toBe(true)
    expect(isNameTaken(rows, '  Implementing ')).toBe(true)
    expect(isNameTaken(rows, 'Done')).toBe(false)
  })

  it('lets a row keep its own name on PATCH', () => {
    expect(isNameTaken(rows, 'Implementing', 1)).toBe(false)
    expect(isNameTaken(rows, 'Implementing', 2)).toBe(true)
  })

  it('catches a re-add whose name yields no slug', () => {
    // The case key uniqueness cannot see: a non-Latin name gets a fresh
    // fallback key every time, so only the name makes creation idempotent.
    expect(isNameTaken([{ id: 1, name: '審查規格' }], '審查規格')).toBe(true)
  })
})

describe('stageVerdict', () => {
  const impl = { states: ['In Progress'] }

  it('agrees when the state is listed, case-insensitively', () => {
    expect(stageVerdict(impl, 'In Progress')).toBe('ok')
    expect(stageVerdict(impl, '  in progress ')).toBe('ok')
  })

  it('reports a conflict when the stage names states and this is not one', () => {
    // The live case this exists for: Linear's GitHub automation moves an issue
    // to Done on the FIRST of several PRs merging, while the stage still says
    // the work is in flight. Both writers are legitimate; the app shows the
    // disagreement instead of picking one.
    expect(stageVerdict(impl, 'Done')).toBe('conflict')
  })

  it('never conflicts when the stage constrains nothing', () => {
    expect(stageVerdict({ states: [] }, 'Done')).toBe('ok')
  })

  it('is unknown — not a conflict — with no stage or an unresolvable one', () => {
    // On a freshly configured lifecycle every issue is unstaged. If that read
    // as a conflict the warning would fire on the entire graph at once and
    // mean nothing.
    expect(stageVerdict(null, 'Done')).toBe('unknown')
    expect(stageVerdict(undefined, 'Done')).toBe('unknown')
  })

  it('is unknown when the Linear state is missing or blank', () => {
    expect(stageVerdict(impl, null)).toBe('unknown')
    expect(stageVerdict(impl, '   ')).toBe('unknown')
  })
})

describe('reorderStages', () => {
  const rows = [{ key: 'a' }, { key: 'b' }, { key: 'c' }]

  it('assigns sort_order by position', () => {
    expect(reorderStages(rows, ['c', 'a', 'b'])).toEqual([
      { key: 'c', sort_order: 0 },
      { key: 'a', sort_order: 1 },
      { key: 'b', sort_order: 2 },
    ])
  })

  it('rejects anything that is not exactly the existing keys once each', () => {
    // A partial or stale list means the client is out of date. Applying it
    // best-effort would interleave two orders and produce a pipeline nobody
    // asked for, so it is refused outright.
    expect(reorderStages(rows, ['a', 'b'])).toBeNull()
    expect(reorderStages(rows, ['a', 'b', 'c', 'd'])).toBeNull()
    expect(reorderStages(rows, ['a', 'b', 'z'])).toBeNull()
    expect(reorderStages(rows, ['a', 'a', 'b'])).toBeNull()
    expect(reorderStages(rows, [1, 2, 3])).toBeNull()
    expect(reorderStages(rows, 'abc')).toBeNull()
  })

  it('accepts an empty reorder of an empty lifecycle', () => {
    expect(reorderStages([], [])).toEqual([])
  })
})

