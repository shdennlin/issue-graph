import { describe, expect, it } from 'vitest'
import { isTypingTarget } from './isTypingTarget'

describe('isTypingTarget', () => {
  it.each(['input', 'textarea', 'select', 'INPUT', 'TextArea', 'SELECT'])(
    'claims %s regardless of tag casing',
    (tagName) => {
      expect(isTypingTarget({ tagName })).toBe(true)
    },
  )

  it('claims a contenteditable element whatever its tag', () => {
    expect(isTypingTarget({ tagName: 'div', isContentEditable: true })).toBe(true)
  })

  // The regression this function exists for: a native select has letter
  // type-ahead, so choosing a status whose name contains "m" used to reach the
  // window handler and toggle wide mode mid-selection.
  it('claims select, which the inline checks it replaced did not', () => {
    expect(isTypingTarget({ tagName: 'select' })).toBe(true)
  })

  // The other half of the contract. Buttons do not consume letters, and
  // treating them as typing targets would disable every shortcut whenever a
  // button holds focus — which, after any click, is most of the time.
  it.each(['button', 'a', 'div', 'span', 'body'])('does not claim %s', (tagName) => {
    expect(isTypingTarget({ tagName })).toBe(false)
  })

  it.each([null, undefined, {}])('handles an absent or shapeless target (%p)', (target) => {
    expect(isTypingTarget(target)).toBe(false)
  })
})
