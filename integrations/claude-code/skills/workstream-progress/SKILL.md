---
name: workstream-progress
description: This skill should be used when work that belongs to an issue-graph workstream reaches a point worth recording — a pull request is open, a check or test suite has run, a spec or design doc is written, a decision is made, or the work of the current pipeline stage is finished. Also use it when asked to "record progress", "update the workstream", "move this to the next stage", "attach this to the stage", or when a SessionStart briefing named a workstream and something it expects has since come into existence. Covers attaching evidence with attach_to_stage, writing a stage note, and moving a workstream with set_workstream_stage.
---

# Recording a workstream's progress

A workstream is a feature in flight. Its position in the pipeline is **stored**,
not derived from anything — so unless somebody records a move, it does not
happen, and the board goes stale while the work goes on.

This skill is that recording step. It is three separate acts, and conflating
them is the mistake to avoid: attaching evidence is cheap and additive, writing
a note is cheap and additive, **moving a stage is a claim about the world.**

## 1. Find out where you are

If this session's SessionStart briefing named a workstream and a stage, that is
your answer — use it.

Otherwise:

```
list_workstreams()            → which workstream, if any, holds this issue
get_workstream(workstreamId)  → its issues in dependency order, and who holds what
```

A branch naming no issue, or an issue in no workstream, is ordinary. If there
is no workstream, there is nothing to record — say so and stop. Do not create
one to have somewhere to write: `create_workstream` groups issues that a person
has decided belong together, and that decision is not yours to invent.

## 2. Read what this stage actually expects

```
list_stages()
```

Each stage carries one list of fields, each `{name, auto, description?}`.

- **`auto: true`** — the app fills it by reading somewhere else (`issue`,
  `session`, `pr`, `spec`, `note`, `blocker`, `ci`). Nothing to do. Attaching
  one by hand duplicates something that is already there and correct.
- **`auto: false`** — nothing appears under this name unless somebody attaches
  it. These are the ones that concern you.
- **`description`** — what this workspace means by the name. Treat it as the
  field's **acceptance criterion**: "the pasted output of `make check`" is not
  satisfied by "tests passed".

Use the stage's own spelling. `check-output` and `checkoutput` are two fields,
and two fields is how one fact becomes zero facts.

## 3. Attach the evidence

```
attach_to_stage(workstreamId, stageKey, kind, value, label?)
```

`kind` is the field name. Five render richly — `pr` (a pull request URL),
`spec` (a path), `ci` (a check run), `issue` (a ticket that matters here
without being a member) and `url` (a plain link). Any other name renders as a
labelled row, which is a first-class outcome.

**Prefer fixing an upstream link over attaching one.** A pull request that
names its issue in the body appears on its own, across repositories, and stays
correct as it moves; a URL you paste is a snapshot that nobody maintains. That
is why everything attached this way carries a `BY HAND` mark. Where the link
could exist upstream — an issue id in the PR body, a `Linear:` line in the
spec — put it there instead and attach nothing.

Adding an issue to the workstream is a different act:

```
update_workstream(workstreamId, add: ["ONE-246"])
```

## 4. Write down anything a person would have to ask about

```
set_stage_note(workstreamId, stageKey, append: "...")   # add a line
set_stage_note(workstreamId, stageKey, body: "...")     # replace
```

Use `append` unless replacing something you wrote. A note a person wrote is a
decision, not a draft.

Notes belong on the stage they are about, which is not always the current one.

## 5. Move the stage — only if it has actually moved

```
set_workstream_stage(workstreamId, stageKey)
```

The bar: **every `auto: false` field on the stage is satisfied as its
description defines it**, and the work the stage names is done. If a field is
legitimately not applicable, say so in the note and move; if you are not sure,
attach what you have, say what is missing, and leave the stage where it is.

Moving **backwards** is ordinary and not a failure — CI going red returns a
workstream to Implementing. A pipeline that only goes forwards gets worked
around by deleting and recreating.

Leaving a workstream a stage behind is a small, visible, self-correcting
problem. Marking a stage done that is not done is invisible and misleads
everyone reading the board.

## What this never does

**It never changes a Linear state.** Those move through Linear's own MCP or
its GitHub automation. An issue's stage is derived from its Linear state; a
second writer on that field is the failure this whole design avoids.

It also does not report the session's presence — hooks already do that, on
their own, with no tool call.
