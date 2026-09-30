// Building the StageContext a stage is drawn from — once for the canvas, and
// once for the StagePanel, from the same function.
//
// It lived inline in views/workstream.ts, so the panel could not draw what the
// card draws: it showed the note and the hand attachments and none of the
// issues, PRs, specs or sessions the card showed right beside it. The panel is
// the card opened up; it must not be the card with things missing.
//
// Split in two because the indexes scan the whole graph and the canvas builds
// dozens of contexts — they are built once and shared, never per stage.

import type { GraphData, LifecycleStageDTO, WorkstreamSummaryDTO } from '@shared/types'
import { indexSessionsByIssue, indexSessionsByWorkstream } from './agentSession'
import { indexBlockedBy, type StageContext } from './stageRender'

export interface StageIndexes {
  byId: Map<string, GraphData['issues'][number]>
  sessionsByIssue: StageContext['sessionsByIssue']
  sessionsByWorkstream: StageContext['sessionsByWorkstream']
  blockedBy: StageContext['blockedBy']
  designdocs: StageContext['designdocs']
}

export function stageIndexes(data: GraphData): StageIndexes {
  return {
    byId: new Map(data.issues.map((i) => [i.identifier, i])),
    sessionsByIssue: indexSessionsByIssue(data.agentSessions),
    sessionsByWorkstream: indexSessionsByWorkstream(data.agentSessions),
    blockedBy: indexBlockedBy(data.issues),
    designdocs: data.designdocs ?? [],
  }
}

export function stageContext(
  idx: StageIndexes,
  workstream: WorkstreamSummaryDTO,
  stage: LifecycleStageDTO,
  pipeline: LifecycleStageDTO[],
): StageContext {
  return {
    workstream,
    stage,
    members: workstream.members
      .map((id) => idx.byId.get(id))
      .filter((i): i is NonNullable<typeof i> => i !== undefined),
    sessionsByIssue: idx.sessionsByIssue,
    sessionsByWorkstream: idx.sessionsByWorkstream,
    designdocs: idx.designdocs,
    blockedBy: idx.blockedBy,
    pipeline,
  }
}
