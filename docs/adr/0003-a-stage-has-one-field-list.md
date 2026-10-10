# 3. A stage has one field list

Status: Accepted — 2026-09-21

## Context

A pipeline stage has to answer one question: **what belongs on this step?**

It was built to answer it twice. `shows` was a closed vocabulary of projections the
stage DRAWS — `pullRequests` meaning "go and read the members' PRs". `fields` was a
free list of names the stage EXPECTS somebody to ATTACH — `runbook`, which nothing
upstream will ever supply.

That reads as a clean distinction. It is not one. It is the same question answered
twice, and keeping the two apart cost three things, each of which surfaced in use
rather than in review:

**One concept, two spellings.** `pr` vs `pullRequests`. `spec` vs `designdocs`.
`issue` vs `issues`. Which name was correct depended on which list you were writing
into, and `stageRender.ts` carried a `KIND_TOKEN` table translating between them —
the clearest possible admission that they were one set.

**`ci` and `note` were legal in BOTH.** Every other mistake hit a validator:
`runbook` in `shows` was a 400. But a `ci` written into the wrong list was accepted
in silence and produced a stage that expected an attachment it never drew. It was
the only failure in this area with no error attached to it, and it was invisible
until somebody looked at a board and wondered why a box was empty.

**The editor grew two widgets.** Seven toggle buttons, then a comma-separated text
box. The second difference was pure implementation leak — `shows` validated against
a closed list so it became buttons, `fields` was free text so it became an input —
and it took three rounds of relabelling, resizing and re-explaining before the
simpler reading won: nobody reads them as two halves of one setting, because they
are not presented as one.

## Decision

**A stage has one list of field names.** Whether the app can fill a name by itself
is a property OF THE NAME — `AUTO_FIELDS` in `shared/fields.ts` — looked up when
drawing. It is never a category the stage sorts a name into.

Migration 17 folds `shows` into `fields` with its names normalised and then DROPS
the column. Dropped rather than left behind: a dead column still holding plausible
data is how the distinction gets reinvented by the next person to read the schema,
and a migration file cannot correct its own past comments. Migration 9 dropped
`issue_stage` for the same reason.

Two consequences follow, and both are load-bearing:

**The list is advisory for anything the app cannot fill.** An attachment of a kind
nobody declared is still accepted and still renders. The list says what belongs
here, not what is permitted — the moment it gates writes, an agent holding
something genuinely new has nowhere to put it. This is the same polarity as the
attachment kinds themselves: a known name is an ENHANCEMENT, never a gate.

**What a name MEANS is workspace-level, not per stage.** `field` (migration 16) is
keyed by name: `runbook` means the same thing on every stage that expects one, and
a per-stage copy would be the same sentence written seven times and then edited in
six of them. The built-in names carry a definition supplied by the app, because
what `spec` means here is decided by the design-doc scanner and not by anybody's
team convention; a workspace's own row overrides it.

## Alternatives rejected

**Keep two lists, rename them to say their direction** (`draws` / `expects`). This
was proposed and withdrawn: it gives a better name to a split that should not
exist, and leaves `ci` legal in both.

**A workspace-level allowlist of the automatic names in use**, so a stage offers
four instead of seven. Rejected on two counts. It shrinks the noise rather than
removing it — the editor now lists only what is ON, with a `+` for the rest, which
removes it entirely. And it would be a third place for the same fact to live, after
the per-stage list and the data itself, so it would drift: declare "we have no CI"
today and the option is simply missing on the day somebody wires up GitHub, with
nothing on screen saying why.

*Deriving* that allowlist instead is not available. Only `designdocs` has a real
capability flag (`hasDesigndoc` means "a scanner is configured", not a row count).
Sessions are TTL-filtered, so an empty list means "nothing is running right now" —
hiding on that would repeat a bug this codebase already carries a comment about,
where `In Review` vanished from the state picker whenever no issue happened to be
under review.

**A separate `description` column on the workstream**, alongside the note. Rejected
for the same reason as everything above: a second free-text field beside the note
has the same job as the note's opening line, which makes it two places to write one
thing and one of them always stale. The note's first line is the summary, the way a
commit message's is.

## Consequences

`KIND_TOKEN` is gone — a name no longer needs translating into itself. `ci` cannot
be put on the wrong side, because there are no longer two sides; the failure mode is
removed by construction rather than caught by a check.

The MCP hands an agent `{name, auto, description?}` per field, so one call answers
what to call a field, whether anything will appear without it, and what belongs in
it. The pipeline-writing tools shipped only after this merge, and that order was
deliberate: a read-only API never touches the both-lists trap, while a write API
would have hit it constantly.

## Revisit when

**An automatic name needs to be filled by hand on one stage and only there.** The
model says auto-ness is a property of the name, globally. If some workspace needs
`pr` projected on one stage and hand-attached on another — genuinely, not as a
workaround — that is the model failing, and a per-entry override is the additive
fix.

**The eighth automatic name arrives and the closed list starts to chafe.** Adding
one is a code change today: an entry in `AUTO_FIELDS` plus a renderer. That is
honest while the app can only fetch what it has a renderer for. If a source ever
becomes configurable — a generic webhook feeding arbitrary named fields — the list
stops being closed for a good reason and this decision needs rereading.
