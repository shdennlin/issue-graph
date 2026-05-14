import { describe, expect, it } from 'vitest'
import { countChecklistBoxes, toggleChecklistAt } from './checklist'

describe('countChecklistBoxes', () => {
  it('counts boxes regardless of state', () => {
    expect(countChecklistBoxes('- [ ] a\n- [x] b\n- [X] c')).toBe(3)
  })
  it('returns 0 when there are none', () => {
    expect(countChecklistBoxes('plain text only')).toBe(0)
  })
})

describe('toggleChecklistAt', () => {
  it('toggles [ ] → [x] at index 0', () => {
    expect(toggleChecklistAt('- [ ] task', 0)).toBe('- [x] task')
  })
  it('toggles [x] → [ ] at index 0', () => {
    expect(toggleChecklistAt('- [x] task', 0)).toBe('- [ ] task')
  })
  it('treats uppercase [X] as checked → unchecks', () => {
    expect(toggleChecklistAt('- [X] task', 0)).toBe('- [ ] task')
  })
  it('toggles only the indexed box', () => {
    const body = '- [ ] a\n- [ ] b\n- [x] c'
    expect(toggleChecklistAt(body, 1)).toBe('- [ ] a\n- [x] b\n- [x] c')
  })
  it('out-of-range index returns body unchanged', () => {
    expect(toggleChecklistAt('- [ ] only', 5)).toBe('- [ ] only')
  })
  it('preserves surrounding text exactly', () => {
    const body = 'pre **bold** - [ ] todo\n```\ncode\n```\n- [ ] two'
    expect(toggleChecklistAt(body, 1)).toBe('pre **bold** - [ ] todo\n```\ncode\n```\n- [x] two')
  })
})
