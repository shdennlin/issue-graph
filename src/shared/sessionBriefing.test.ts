import { describe, it, expect } from 'vitest'
import { sessionBriefing, type BriefingInput } from './sessionBriefing.js'

const base: BriefingInput = {
  identifier: 'ONE-393',
  workstream: { name: 'OAuth migration', note: 'Replace the hand-rolled token flow.\n\nDetail.' },
  stage: {
    key: 'implementing',
    name: 'Implementing',
    nextCommand: '`make check`',
    fields: ['issue', 'session', 'check-output', 'branch'],
  },
  pipeline: [
    { key: 'discuss', name: 'Discuss' },
    { key: 'implementing', name: 'Implementing' },
    { key: 'review', name: 'Result review' },
  ],
  meanings: { 'check-output': 'The pasted output of make check.' },
}

describe('sessionBriefing', () => {
  it('names the issue, the workstream, the stage and the one after it', () => {
    const t = sessionBriefing(base)!
    expect(t).toContain('ONE-393')
    expect(t).toContain('"OAuth migration"')
    expect(t).toContain('"Implementing"')
    expect(t).toContain('The stage after it is "Result review".')
  })

  it('takes the first line of the note, not the whole note', () => {
    const t = sessionBriefing(base)!
    expect(t).toContain('Replace the hand-rolled token flow.')
    expect(t).not.toContain('Detail.')
  })

  it('lists only the fields somebody has to attach', () => {
    // `issue` and `session` are filled by the app. Listing them would invite a
    // session to supply something that is already there.
    const t = sessionBriefing(base)!
    expect(t).toContain('- check-output: The pasted output of make check.')
    expect(t).toContain('- branch')
    expect(t).not.toContain('- issue')
    expect(t).not.toContain('- session')
  })

  it('says nothing about attachments when the stage expects none by hand', () => {
    const t = sessionBriefing({ ...base, stage: { ...base.stage!, fields: ['issue', 'note'] } })!
    expect(t).not.toContain('attached by hand')
  })

  it('states facts and never gives an order', () => {
    // Claude Code surfaces injected text that reads as an out-of-band system
    // instruction to the user instead of using it, and ADR-0002 wants the
    // judgement made after the work rather than announced before it. Both
    // rules land on the same sentence shape, so this guards both.
    const t = sessionBriefing(base)!.toLowerCase()
    for (const order of ['you must', 'you should', 'please ', 'call set_workstream_stage', 'run `make']) {
      expect(t).not.toContain(order)
    }
    expect(t).toContain('the command usually run at that stage is')
  })

  it('returns null when the branch names nothing and belongs to nothing', () => {
    // The common case. Spending context to announce an absence every session
    // is how a hook gets switched off.
    expect(sessionBriefing({ ...base, identifier: null, workstream: null })).toBeNull()
  })

  it('still reports an issue that is in no workstream', () => {
    const t = sessionBriefing({ ...base, workstream: null, stage: null })!
    expect(t).toBe('This branch names ONE-393, which is not in any workstream.')
  })

  it('handles a workstream sitting on no stage', () => {
    const t = sessionBriefing({ ...base, stage: null })!
    expect(t).toContain('It is not on a pipeline stage.')
    expect(t).not.toContain('The stage after')
  })

  it('says so when the stage is the last one', () => {
    const t = sessionBriefing({
      ...base,
      stage: { ...base.stage!, key: 'review', name: 'Result review' },
    })!
    expect(t).toContain('It is the last stage in the pipeline.')
  })

  it('does not claim a next stage for a stage missing from the pipeline', () => {
    // A workstream can point at a key that was deleted; it reads as unknown
    // rather than as "the first stage", and guessing a successor from index
    // -1 would name the pipeline's second stage to every orphan.
    const t = sessionBriefing({ ...base, stage: { ...base.stage!, key: 'gone' } })!
    expect(t).toContain('It is the last stage in the pipeline.')
    expect(t).not.toContain('The stage after it is "Implementing"')
  })

  it('omits an empty next command rather than printing a bare sentence', () => {
    const t = sessionBriefing({ ...base, stage: { ...base.stage!, nextCommand: '  ' } })!
    expect(t).not.toContain('The command usually run')
  })

  it('caps the field list so one stage cannot become a wall of text', () => {
    const many = Array.from({ length: 12 }, (_, i) => `field-${i}`)
    const t = sessionBriefing({ ...base, stage: { ...base.stage!, fields: many } })!
    expect(t.match(/^- /gm)).toHaveLength(6)
  })
})
