# Architecture decision records

One file per decision that a future reader would otherwise have to reverse-engineer
from the code — the ones where the code shows *what* and cannot show *why not*.

## Why this exists

`docs/PRD.md` §16 holds a decision log, but it is frozen: the PRD was marked a
historical snapshot in `685d847` (2026-05-03) and its entries describe the shape of
the project as it was planned, not as it is. Decision #43 still says the runtime is
Node-compatible via `better-sqlite3` — that reversed to a hard `bun:sqlite`
requirement and nothing went back to amend it. A log that is not maintained is worse
than no log, because it is read as current.

So §16 stays as history, and decisions taken from 2026-09 onward live here.

## What belongs here

A decision worth a record has **a rejected alternative a reasonable person would
have picked**. "We used dagre for layout" is not a record; "we rejected cytoscape
because …" is. If there is nothing to reject, the code comment is enough.

Most of this project's reasoning stays in code comments and commit messages, and
that is deliberate — it cannot drift from what it describes. A record earns its own
file only when the reasoning spans more than one file, or when the decision is to
*not* do something and there is therefore no code to hang a comment on.

## Format

`NNNN-kebab-case-title.md`, numbered in the order taken. Sections: Status, Context,
Decision, Consequences, Revisit when. Keep them short — a record nobody finishes
reading protects nobody.

Records are immutable once accepted. A reversal is a new record that supersedes the
old one, and the old one gets a `Superseded by` line. Editing history to match the
present is how §16 got into the state it is in.
