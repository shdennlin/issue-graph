// What a Claude Code session is told about its own position, at the moment it
// starts.
//
// The hook plugin reports presence to POST /api/agent-sessions, which already
// resolves the branch to an issue. This turns that answer plus the workstream
// around it into the text the SessionStart hook prints, and Claude Code adds a
// SessionStart hook's stdout to the session's context.
//
// TWO RULES SHAPE EVERY SENTENCE HERE, and they come from different places:
//
// 1. FACTS, NOT ORDERS. Claude Code's own hook documentation says injected
//    text must read as factual statements, because text framed as an
//    out-of-band system instruction trips the model's prompt-injection
//    defences and gets surfaced to the user instead of used. So: "the usual
//    command here is X", never "run X".
// 2. The same shape is what docs/adr/0002 requires for its own reason. A
//    workstream's stage is STORED, and the judgement of whether it has moved
//    can only be made after the work, by whoever did it. A briefing that said
//    "when you finish, call set_workstream_stage('review')" would settle that
//    question before the session has done anything — the same error as a hook
//    advancing the stage on its own, relocated into a sentence.
//
// Pure, and in shared/, so it can be tested: vitest runs on Node and anything
// reaching `bun:sqlite` cannot load at all. The route hands it rows.

import { isAutoField } from './fields.js'
import { noteSummary } from './noteSummary.js'

export interface BriefingStage {
  key: string
  name: string
  nextCommand: string | null
  fields: string[]
}

export interface BriefingInput {
  /** The issue this branch names, or null — a branch carrying no id is normal. */
  identifier: string | null
  workstream: { name: string; note: string | null } | null
  /** The stage that workstream is on, or null when it is not on one. */
  stage: BriefingStage | null
  /** Every stage in pipeline order, for naming the one after the current. */
  pipeline: { key: string; name: string }[]
  /** Field name → what this workspace means by it. */
  meanings: Record<string, string>
}

/** Keeps one briefing from becoming a wall: enough to orient, not a manual. */
export const BRIEFING_FIELD_MAX = 6

/**
 * The briefing, or null when there is nothing worth saying.
 *
 * Null rather than an empty string, and null rather than a cheerful "no
 * workstream found": a session on a branch with no issue is the common case,
 * not a problem, and spending context to announce an absence every time would
 * make people turn the hook off.
 */
export function sessionBriefing(input: BriefingInput): string | null {
  const { identifier, workstream, stage } = input
  if (identifier === null && workstream === null) return null

  const lines: string[] = []

  if (identifier !== null && workstream === null) {
    // Worth saying on its own: it tells the session which issue it is on, and
    // that nothing groups it with anything else.
    lines.push(`This branch names ${identifier}, which is not in any workstream.`)
    return lines.join('\n')
  }

  const where = identifier === null ? 'This branch' : `${identifier}, which this branch names,`
  lines.push(`${where} belongs to the workstream "${workstream!.name}".`)

  const why = noteSummary(workstream!.note)
  if (why !== null) lines.push(`What it is for: ${why}`)

  if (stage === null) {
    lines.push('It is not on a pipeline stage.')
  } else {
    lines.push(`It is at the stage "${stage.name}".`)
    if (stage.nextCommand !== null && stage.nextCommand.trim() !== '') {
      lines.push(`The command usually run at that stage is ${stage.nextCommand}.`)
    }

    const i = input.pipeline.findIndex((s) => s.key === stage.key)
    const after = i >= 0 ? input.pipeline[i + 1] : undefined
    lines.push(
      after === undefined
        ? 'It is the last stage in the pipeline.'
        : `The stage after it is "${after.name}".`,
    )

    // Only the attachable ones. An automatic name is filled by the app by
    // reading somewhere else, so listing it would invite a session to supply
    // something that is already there — and the list is how a person decides
    // what to hand over, which is the whole reason it is worth the tokens.
    const byHand = stage.fields.filter((f) => !isAutoField(f)).slice(0, BRIEFING_FIELD_MAX)
    if (byHand.length > 0) {
      lines.push('That stage expects these to be attached by hand:')
      for (const name of byHand) {
        const meaning = input.meanings[name]
        lines.push(meaning === undefined ? `- ${name}` : `- ${name}: ${meaning}`)
      }
    }
  }

  lines.push(
    'The workstream moves between stages only when someone records the move; nothing advances it on its own.',
  )
  return lines.join('\n')
}
