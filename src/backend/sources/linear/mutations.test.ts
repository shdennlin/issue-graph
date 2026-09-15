import { describe, expect, it } from 'vitest'
import { buildIssuePatchInput } from './index.js'

// The mapping from our IssuePatch to Linear's IssueUpdateInput. Everything that
// can go wrong here is about a key being present or absent, not about its
// value — IssueUpdateInput only touches the fields it is handed, and treats an
// explicit null as "clear this field".
describe('buildIssuePatchInput', () => {
  it('carries a state change through', () => {
    expect(buildIssuePatchInput({ stateId: 'state-1' })).toEqual({ stateId: 'state-1' })
  })

  it('carries an assignment through', () => {
    expect(buildIssuePatchInput({ assigneeId: 'user-1' })).toEqual({ assigneeId: 'user-1' })
  })

  it('sends both when both change, so one round trip does the work of two', () => {
    expect(buildIssuePatchInput({ stateId: 's', assigneeId: 'u' })).toEqual({
      stateId: 's',
      assigneeId: 'u',
    })
  })

  // The pair this function exists for. Absent and null are different requests,
  // and a truthiness check would collapse them — making it impossible to
  // unassign, while silently clearing the assignee on every state-only change.
  it('omits an absent assigneeId rather than clearing the assignee', () => {
    const input = buildIssuePatchInput({ stateId: 'state-1' })
    expect('assigneeId' in input).toBe(false)
  })

  it('keeps an explicit null, which is how Linear spells "unassign"', () => {
    const input = buildIssuePatchInput({ assigneeId: null })
    expect('assigneeId' in input).toBe(true)
    expect(input.assigneeId).toBeNull()
  })

  it('unassigns and re-states in the same patch', () => {
    expect(buildIssuePatchInput({ stateId: 's', assigneeId: null })).toEqual({
      stateId: 's',
      assigneeId: null,
    })
  })

  // An empty input is what the adapter refuses to send: Linear would answer
  // success:true for a mutation that changed nothing, and the caller would
  // paint a change that never happened.
  it('produces an empty object for an empty patch', () => {
    expect(buildIssuePatchInput({})).toEqual({})
  })

  it('treats an undefined stateId as absent, not as a value', () => {
    expect(buildIssuePatchInput({ stateId: undefined })).toEqual({})
  })

  // Priority 0 means "No priority" — a value the user can pick from the
  // dropdown. A truthiness guard would make it the one unreachable choice
  // while silently dropping the request.
  it.each([0, 1, 2, 3, 4])('carries priority %i, including the falsy one', (priority) => {
    expect(buildIssuePatchInput({ priority })).toEqual({ priority })
  })

  it('omits priority when it is not part of the patch', () => {
    expect('priority' in buildIssuePatchInput({ stateId: 's' })).toBe(false)
  })

  it('sends label additions and removals as a delta', () => {
    expect(buildIssuePatchInput({ addedLabelIds: ['l1'], removedLabelIds: ['l2'] })).toEqual({
      addedLabelIds: ['l1'],
      removedLabelIds: ['l2'],
    })
  })

  // An empty array is accepted by Linear but means "change nothing", so
  // sending one turns a no-op into a real mutation — and, because the route
  // rejects an empty patch, dropping it here is what makes that rejection fire.
  it.each(['addedLabelIds', 'removedLabelIds'] as const)('drops an empty %s', (key) => {
    expect(buildIssuePatchInput({ [key]: [] })).toEqual({})
  })

  it('combines every dimension in one round trip', () => {
    expect(
      buildIssuePatchInput({
        stateId: 's',
        assigneeId: null,
        priority: 0,
        addedLabelIds: ['l1'],
      }),
    ).toEqual({ stateId: 's', assigneeId: null, priority: 0, addedLabelIds: ['l1'] })
  })
})
