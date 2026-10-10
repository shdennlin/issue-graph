---
description: Where this branch sits in its issue-graph workstream — the stage, what it expects, and what is missing
---

Report where the current work sits, and nothing else. Do not attach anything,
do not move anything, do not offer to.

1. `list_workstreams` — find the one holding this branch's issue. The
   SessionStart briefing may already have named it; confirm rather than assume,
   because it was true at session start and stages move.
2. `get_workstream` — its issues in dependency order, who holds what, what is
   blocked.
3. `list_stages` — the pipeline, and what the current stage's fields mean.

Then answer, briefly:

- the workstream, and what it is for (its note's first line)
- the stage it is on, and the stage after it
- which of that stage's `auto: false` fields are still empty, with what each
  one's `description` says would satisfy it
- anything claimed by another session

If this branch names no issue, or the issue is in no workstream, say exactly
that in one line. That is the ordinary case, not a fault to diagnose.
