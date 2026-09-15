# 1. Keep the hand-rolled fuzzy matcher in the quick switcher

Status: Accepted — 2026-09-15

## Context

`Cmd+K` ranks a few hundred candidates (issues across open tabs, notes, tabs) as
you type. The scorer is `src/frontend/components/quickSwitcher/fuzzyMatch.ts`:
~40 lines of subsequence matching with prefix and word-boundary bonuses, written
in `e343cf5` (2026-05-14).

That commit has no body. The only recorded justification is a comment in the
file — "No new dependency" — which is an assertion rather than an argument, and
one the project does not otherwise live by: there are 21 runtime dependencies,
including dagre, three dnd-kit packages, dompurify, marked and reactflow. So the
question "why isn't this a library?" had no answer anyone could find, which is
what prompted this record.

It surfaced through a bug. Searching `393` listed ONE-329 and ONE-349 above
ONE-393, because the scorer ran against a single concatenated string:

```ts
label: `${i.identifier} ${i.title}`   // "ONE-329 [2/3] Live attack-chain"
```

A subsequence could therefore span two unrelated fields — `3` and `9` from the
identifier, the third `3` from the title — and collect word-boundary bonuses on
the way. Fixed in `d2e5783` by scoring an identifier hit in a band above any
fuzzy score.

The Raycast extension is not affected and is not part of this decision: it
delegates matching to Raycast entirely, passing `title` and `keywords` as
separate fields. Which engine to use is a question for the web palette alone.

## Decision

Keep the hand-rolled scorer. Do not adopt Fuse.js or an equivalent now.

Three reasons, in order of weight:

1. **The rule that matters is a product rule, not a similarity rule.** "Naming
   an issue outranks resembling one" is not something a fuzzy library computes —
   it is a statement about what the user meant. Fuse.js scores 0 for a perfect
   match and 1 for a mismatch, inverted from ours and composited with key weight
   and field-length norm; layering a product band on a scale we do not own means
   reasoning about someone else's normalization every time the rule changes. In
   our own scorer it is three lines.
2. **The candidate set is small.** A few hundred rows, rescored per keystroke.
   There is nothing here an index would buy.
3. **It is 40 lines with 13 tests.** The cost of owning it is visible and paid.

**This is explicitly not a defence of the concatenated `label`.** That was the
actual defect, and it is the one thing a library would have prevented — with
`keys: [{ name: 'identifier', weight: 2 }, { name: 'title', weight: 1 }]` the
cross-field subsequence cannot form, because the fields are never joined. The
lesson generalizes past the engine choice: **score fields separately, whatever
does the scoring.** A hand-rolled matcher over separate fields would not have had
this bug either.

## Consequences

- **No typo tolerance.** Subsequence matching requires every query character to
  appear, in order: `lgoin` will not find `login crash`. This is the one real
  capability gap, and it is accepted.
- **The id-reference rule is duplicated.** `isIdQuery` in
  `integrations/raycast/src/lib/display.ts` restates the same "all digits, or
  contains a dash" test as `fuzzyMatch.ts`, because the Raycast extension builds
  independently and cannot import from `src/frontend`. Both carry a comment
  pointing at the other. Change one, change both.
- Ranking behaviour stays ours to tune, and ours to get wrong.

## Revisit when

**Typo tolerance is wanted.** That is the trigger — not bundle size, not
line count, not a general preference for libraries.

When it arrives, do both things at once: adopt the library *and* split `label`
into weighted keys. Swapping the engine while keeping the concatenated field
would carry this record's actual defect into the new implementation.
