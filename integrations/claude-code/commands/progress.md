---
description: Record what this session has finished into its issue-graph workstream — attach the evidence, note the decisions, move the stage only if it has moved
argument-hint: optional — what changed, if it is not obvious from the session
---

Use the `workstream-progress` skill and follow it.

$ARGUMENTS

Work in this order, and stop at the first step that has no answer:

1. **Locate.** Which workstream and stage. No workstream means nothing to
   record — say so in one line and stop.
2. **Compare.** What the stage's `auto: false` fields expect, against what this
   session actually produced. Say what is missing before writing anything.
3. **Attach** what exists, under the stage's own field names. Where an upstream
   link could carry it instead — an issue id in a PR body, a `Linear:` line in
   a spec — say so and prefer that.
4. **Note** anything a person would otherwise have to ask you about.
5. **Move the stage only if it has genuinely moved.** If anything the stage
   expects is missing and not legitimately inapplicable, leave it and report
   what is outstanding.

Report what you wrote, one line per write. If you moved nothing, say why —
"nothing to record" is a complete and correct answer.

Never change a Linear state.
