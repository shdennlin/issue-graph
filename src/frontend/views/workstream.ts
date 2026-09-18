// Workstream view — the pipeline first, everything else in support of it.
//
// The other container views draw issues and group them. This one draws STAGES,
// because the question it answers is "where has this feature got to", and the
// answer is a position in a pipeline rather than a set of cards. The issues,
// the sessions, the PRs and the specs appear inside the stage that asked for
// them, via `shows` — see lib/stageRender.ts, which decides all of it.
//
// Two modes, on `focusedWorkstreamId`:
//
//   null   overview — the workspace's pipeline drawn once, with every
//          workstream standing on the stage it reached. "Which of my features
//          is stuck, and where."
//   <id>   focused  — that one workstream's own row of stages, each filled in
//          with what it shows. "What is the state of this one feature."
//
// A DEPARTURE worth knowing about: this view does not apply the filter bar.
// Every other container view draws a subset of the graph, so filtering it is
// filtering the picture. Here the subject is the workstream, and its members
// are a fact about it — hiding three of five because of a label filter would
// not narrow the picture, it would make the stage misreport what it contains.
// Members are resolved straight from `data.issues`, and a member outside the
// sync window is listed as missing rather than dropped.

import type { Edge, Node } from 'reactflow'
import type { LifecycleStageDTO, WorkstreamSummaryDTO } from '@shared/types.js'
import { daysOnStage, isStale } from '@shared/staleness.js'
import type { ViewContext, ViewDefinition } from './types'
import { buildChainLayout } from './chainLayout'
import { indexBlockedBy, renderStage, type StageContext } from '../lib/stageRender'
import { indexSessionsByIssue } from '../lib/agentSession'
import type { StageNodeData } from '../components/nodes/StageNode'

const STAGE_W = 340
const GAP_X = 28
const ROW_GAP = 34
const MAX_PER_ROW = 4

// These must track .stage-node in globals.css. GraphCanvas measures only
// `.react-flow__node-issue`, so a stage node never receives a corrected height
// and a wrong number here shows up as overlap rather than healing itself.
const HEAD_H = 34
const ITEM_H = 22
const BODY_PAD = 10

/** Wording never changes how many rows there are, so counting with an identity
 *  translator gives exactly the height the component will render. */
const IDENT = ((k: string) => k) as Parameters<typeof renderStage>[1]

export function stageNodeHeight(itemCount: number): number {
  return HEAD_H + BODY_PAD * 2 + Math.max(1, itemCount) * ITEM_H
}

/**
 * The slot for workstreams that have not been put on a stage yet.
 *
 * They must land somewhere visible: a workstream someone created and never
 * staged is precisely the one at risk of being forgotten, and dropping it would
 * make this view quietly disagree with the Workstreams panel about how many
 * exist. The parentheses are what make it safe — a real stage key matches
 * `^[a-z0-9]+(-[a-z0-9]+)*$`, so no key can ever collide with this one.
 */
const NOT_STARTED = '(not-started)'

function place(index: number): { x: number; y: number } {
  const col = index % MAX_PER_ROW
  const row = Math.floor(index / MAX_PER_ROW)
  // Rows are spaced for a six-item stage rather than measured, so a tall stage
  // in one row cannot push the next row down on top of a short one.
  return { x: col * (STAGE_W + GAP_X), y: row * (stageNodeHeight(6) + ROW_GAP) }
}

export const workstreamView: ViewDefinition = {
  id: 'workstream',
  label: 'Workstreams',
  description:
    'Your pipeline, stage by stage. Shows where each feature in flight has got to, and what is sitting on every step.',
  build(ctx) {
    const { data, chainRootIds, focusedWorkstreamId } = ctx

    // Chain mode dissolves this like every other container view — the chain is
    // the subject then, and a pipeline has nothing to say about it.
    if (chainRootIds.length > 0) return buildChainLayout(ctx, () => null)

    const stages = [...(data.lifecycle ?? [])].sort((a, b) => a.sortOrder - b.sortOrder)
    const streams = (data.workstreams ?? []).filter((w) => w.status !== 'archived')

    if (stages.length === 0) {
      // A blank canvas reads as "nothing is happening" when the truth is
      // "nothing is configured", and those need different actions.
      return {
        nodes: [
          {
            id: 'stage:none',
            type: 'stage',
            data: {
              ordinal: 0,
              name: '',
              placeholder: 'noStages',
              current: false,
              render: null,
              streams: [],
              daysHere: null,
              stale: false,
            } satisfies StageNodeData,
            position: { x: 0, y: 0 },
            width: STAGE_W,
            height: stageNodeHeight(0),
          },
        ],
        edges: [],
      }
    }

    const focused = streams.find((w) => w.id === focusedWorkstreamId) ?? null
    const nodes: Node[] = focused ? buildFocused(focused, stages, ctx) : buildOverview(streams, stages)

    // The pipeline arrow. Edges follow the ORDER, not the wrapping, so a
    // pipeline that wraps onto a second row still reads as one sequence.
    const edges: Edge[] = []
    for (let i = 0; i + 1 < nodes.length; i++) {
      const a = nodes[i]!
      const b = nodes[i + 1]!
      edges.push({ id: `${a.id}->${b.id}`, source: a.id, target: b.id })
    }
    return { nodes, edges }
  },
}

export function buildOverview(streams: WorkstreamSummaryDTO[], stages: LifecycleStageDTO[]): Node[] {
  const now = Date.now()
  const byStage = new Map<string, StageNodeData['streams']>()
  const known = new Map(stages.map((s) => [s.key, s]))
  for (const w of streams) {
    // A stage key that no longer exists reads as unstaged rather than vanishing:
    // deleting a stage from the lifecycle must not take the workstreams that
    // were standing on it off the board.
    const key = w.stage !== null && known.has(w.stage) ? w.stage : NOT_STARTED
    const list = byStage.get(key) ?? []
    list.push({
      id: w.id,
      name: w.name,
      days: daysOnStage(w.stageEnteredAt, now),
      stale: isStale(w.stageEnteredAt, known.get(key)?.staleAfterDays ?? null, now),
    })
    byStage.set(key, list)
  }

  const slots: { key: string; name: string; placeholder: 'notStarted' | null; ordinal: number }[] = [
    // Ordinal 0, before the first real step: this is not part of the pipeline,
    // it is what has not entered it. Drawn only when somebody is in it.
    ...(byStage.has(NOT_STARTED)
      ? [{ key: NOT_STARTED, name: '', placeholder: 'notStarted' as const, ordinal: 0 }]
      : []),
    ...stages.map((s, i) => ({ key: s.key, name: s.name, placeholder: null, ordinal: i + 1 })),
  ]

  return slots.map((slot, i) => {
    const on = byStage.get(slot.key) ?? []
    return {
      id: `stage:${slot.key}`,
      type: 'stage',
      data: {
        ordinal: slot.ordinal,
        name: slot.name,
        placeholder: slot.placeholder,
        // "Current" in the overview means somebody is standing here. The stages
        // with nobody on them are the ones you can skip reading.
        current: on.length > 0,
        render: null,
        streams: on,
        daysHere: null,
        stale: on.some((s) => s.stale),
      } satisfies StageNodeData,
      position: place(i),
      width: STAGE_W,
      height: stageNodeHeight(on.length),
    }
  })
}

export function buildFocused(
  workstream: WorkstreamSummaryDTO,
  stages: LifecycleStageDTO[],
  ctx: ViewContext,
): Node[] {
  const { data } = ctx
  const now = Date.now()
  const byId = new Map(data.issues.map((i) => [i.identifier, i]))
  const members = workstream.members
    .map((id) => byId.get(id))
    .filter((i): i is NonNullable<typeof i> => i !== undefined)

  // Built once and shared by every stage. `blockedBy` scans the whole graph,
  // which is exactly why it must not happen once per stage.
  const sessionsByIssue = indexSessionsByIssue(data.agentSessions)
  const blockedBy = indexBlockedBy(data.issues)
  const designdocs = data.designdocs ?? []

  return stages.map((stage, i) => {
    const render: StageContext = { workstream, stage, members, sessionsByIssue, designdocs, blockedBy }
    const current = workstream.stage === stage.key
    return {
      id: `stage:${stage.key}`,
      type: 'stage',
      data: {
        ordinal: i + 1,
        name: stage.name,
        placeholder: null,
        current,
        render,
        streams: [],
        // Only on the stage it is actually on: `stageEnteredAt` times the
        // CURRENT occupancy, so showing it elsewhere would date a stay that is
        // not happening.
        daysHere: current ? daysOnStage(workstream.stageEnteredAt, now) : null,
        stale: current && isStale(workstream.stageEnteredAt, stage.staleAfterDays, now),
      } satisfies StageNodeData,
      position: place(i),
      width: STAGE_W,
      height: stageNodeHeight(renderStage(render, IDENT).length),
    }
  })
}
