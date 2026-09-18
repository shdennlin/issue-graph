// Workstream view — the pipeline first, everything else in support of it.
//
// The other container views draw issues and group them. This one draws STAGES,
// because the question it answers is "where has this feature got to", and the
// answer is a position in a pipeline rather than a set of cards. The issues,
// the sessions, the PRs and the specs appear inside the stage that asked for
// them, via `shows` — see lib/stageRender.ts, which decides all of it.
//
// EVERY workstream is drawn, each as its own container with its own row of
// stages inside — the same `mixedContainer` + `parentNode` arrangement the mix
// and project views use, so nothing new had to be invented for the layout.
//
// An earlier cut drew ONE shared pipeline with the workstreams as name chips
// on the stage each had reached. It answered "who is where" and nothing else:
// you could not see a single workstream's contents without leaving the
// overview, so the two questions people actually hold at once — "what is in
// flight" and "how far has each got" — needed two different screens.
//
// `focusedWorkstreamId` now ISOLATES rather than switching mode: null draws
// every container, an id draws that one alone. Same picture either way, which
// is why coming back from an isolation costs nothing to re-read.
//
// A DEPARTURE worth knowing about: this view does not apply the filter bar.
// Every other container view draws a subset of the graph, so filtering it is
// filtering the picture. Here the subject is the workstream, and its members
// are a fact about it — hiding three of five because of a label filter would
// not narrow the picture, it would make the stage misreport what it contains.
// Members are resolved straight from `data.issues`, and a member outside the
// sync window is listed as missing rather than dropped.

import { MarkerType, type Edge, type Node } from 'reactflow'
import { isStale } from '@shared/staleness.js'
import { stageVisits } from '@shared/stageHistory.js'
import { compactAge } from '../lib/relativeTime'
import type { ViewDefinition } from './types'
import { buildChainLayout } from './chainLayout'
import { indexBlockedBy, renderStage, type StageContext } from '../lib/stageRender'
import { indexSessionsByIssue } from '../lib/agentSession'
import type { StageNodeData } from '../components/nodes/StageNode'
import type { StageNotesData } from '../components/nodes/StageNotesNode'

const STAGE_W = 340
const GAP_X = 28
const ROW_GAP = 34
const PADDING = 20
const ROW_GAP_INNER = 26
// Matches .mixed-container-header — the container's own title bar, which the
// stages have to start below.
const HEADER = 32
const COLOR = 'var(--accent)'

// These must track .stage-node in globals.css. GraphCanvas measures only
// `.react-flow__node-issue`, so a stage node never receives a corrected height
// and a wrong number here shows up as overlap rather than healing itself.
const HEAD_H = 34
const ITEM_H = 22
const BODY_PAD = 10

/** Wording never changes how many rows there are, so counting with an identity
 *  translator gives exactly the height the component will render. */
const IDENT = ((k: string) => k) as Parameters<typeof renderStage>[1]

/** Where stage `index` sits, given `cols` per row and alternating direction.
 *  An odd row is mirrored, which is the whole trick. */
export function serpentine(index: number, cols: number): { row: number; col: number } {
  const row = Math.floor(index / cols)
  const within = index % cols
  return { row, col: row % 2 === 0 ? within : cols - 1 - within }
}

export function stageNodeHeight(itemCount: number): number {
  return HEAD_H + BODY_PAD * 2 + Math.max(1, itemCount) * ITEM_H
}

export const workstreamView: ViewDefinition = {
  id: 'workstream',
  label: 'Workstreams',
  description:
    'Every feature in flight, each with its own pipeline. Shows how far each has got and what is sitting on every step.',
  build(ctx) {
    const { data, chainRootIds, focusedWorkstreamId, maxColsPerRow } = ctx

    // Chain mode dissolves this like every other container view — the chain is
    // the subject then, and a pipeline has nothing to say about it.
    if (chainRootIds.length > 0) return buildChainLayout(ctx, () => null)

    const stages = [...(data.lifecycle ?? [])].sort((a, b) => a.sortOrder - b.sortOrder)
    if (stages.length === 0) return { nodes: [emptyPipelineNode()], edges: [] }

    const all = (data.workstreams ?? []).filter((w) => w.status !== 'archived')
    // An id that matches nothing falls back to everything rather than blanking
    // the canvas — a stale `?stream=` in a bookmark must not look like "no
    // workstreams exist".
    const streams = focusedWorkstreamId === null ? all : all.filter((w) => w.id === focusedWorkstreamId)
    const shown = streams.length > 0 ? streams : all

    const now = Date.now()
    // Built once for the whole canvas and shared by every stage of every
    // workstream. `blockedBy` scans the entire graph, which is exactly why it
    // must not happen per stage.
    const byId = new Map(data.issues.map((i) => [i.identifier, i]))
    const sessionsByIssue = indexSessionsByIssue(data.agentSessions)
    const blockedBy = indexBlockedBy(data.issues)
    const designdocs = data.designdocs ?? []

    const nodes: Node[] = []
    const edges: Edge[] = []
    let y = 0

    for (const workstream of shown) {
      const members = workstream.members
        .map((id) => byId.get(id))
        .filter((i): i is NonNullable<typeof i> => i !== undefined)
      const visits = stageVisits(workstream.stageEvents, now)

      const built = stages.map((stage, i) => {
        const render: StageContext = { workstream, stage, members, sessionsByIssue, designdocs, blockedBy }
        return { stage, i, render, items: renderStage(render, IDENT).length }
      })
      // Wraps at the user's "Issues per row" setting, and every other row runs
      // BACKWARDS, so the pipeline reads as one continuous line instead of
      // making the eye jump back to the left margin between rows:
      //   1 → 2 → 3 → 4
      //               ↓
      //   8 ← 7 ← 6 ← 5
      // The notes card is the FIRST cell, before stage 1. It is the context
      // you want before reading where the thing has got to — and at the end of
      // a serpentine walk it landed in whichever corner the wrap happened to
      // leave, which was never the same place twice.
      const cellCount = stages.length + 1
      const cols = Math.max(1, Math.min(cellCount, maxColsPerRow))
      const rows = Math.ceil(cellCount / cols)
      // One height for every stage in the workstream rather than per row: a
      // serpentine row above a taller one would otherwise leave the vertical
      // drop landing in the middle of a box.
      const cellH = Math.max(...built.map((b) => stageNodeHeight(b.items)))
      const containerH = HEADER + PADDING + rows * cellH + (rows - 1) * ROW_GAP_INNER + PADDING
      const containerW = PADDING * 2 + cols * STAGE_W + (cols - 1) * GAP_X
      const containerId = `workstream:${workstream.id}`

      nodes.push({
        id: containerId,
        type: 'mixedContainer',
        data: {
          bucket: {
            id: String(workstream.id),
            name: workstream.name,
            color: COLOR,
            count: workstream.members.length,
            projectId: null,
          },
        },
        position: { x: 0, y },
        width: containerW,
        height: containerH,
        style: { width: containerW, height: containerH },
      })

      for (const b of built) {
        const visit = visits.get(b.stage.key)
        const current = workstream.stage === b.stage.key
        const h = cellH
        const cell = serpentine(b.i + 1, cols)
        nodes.push({
          id: `${containerId}/stage:${b.stage.key}`,
          type: 'stage',
          parentNode: containerId,
          data: {
            ordinal: b.i + 1,
            name: b.stage.name,
            placeholder: null,
            current,
            render: b.render,
            // Every stage now carries a time, not just the one it is on. That
            // is the difference between showing a position and showing a
            // journey — six of seven stages used to be blank.
            // Reduced here rather than in the component: the view is where the
            // clock is read, and a component that calls Date.now() in render is
            // the impurity `react-hooks` flags.
            age: visit ? compactAge(visit.enteredAt, visit.leftAt ?? now) : null,
            visited: visit !== undefined,
            visits: visit?.visits ?? 0,
            stale: current && isStale(workstream.stageEnteredAt, b.stage.staleAfterDays, now),
          } satisfies StageNodeData,
          position: {
            x: PADDING + cell.col * (STAGE_W + GAP_X),
            y: HEADER + PADDING + cell.row * (cellH + ROW_GAP_INNER),
          },
          width: STAGE_W,
          height: h,
          style: { width: STAGE_W, height: h },
        })
      }

      const notesCell = serpentine(0, cols)
      nodes.push({
        id: `${containerId}/notes`,
        type: 'stageNotes',
        parentNode: containerId,
        data: {
          notes: stages
            .filter((st) => (workstream.notes[st.key] ?? '').trim().length > 0)
            .map((st) => ({
              stageKey: st.key,
              stageName: st.name,
              body: (workstream.notes[st.key] ?? '').trim(),
            })),
        } satisfies StageNotesData,
        position: {
          x: PADDING + notesCell.col * (STAGE_W + GAP_X),
          y: HEADER + PADDING + notesCell.row * (cellH + ROW_GAP_INNER),
        },
        width: STAGE_W,
        height: cellH,
        style: { width: STAGE_W, height: cellH },
      })

      // The pipeline arrow, within this workstream only. Handles are chosen
      // per edge because the direction changes: within a row it leaves the
      // trailing edge, and at a row break it drops straight down.
      for (let i = 0; i + 1 < built.length; i++) {
        const a = `${containerId}/stage:${built[i]!.stage.key}`
        const b = `${containerId}/stage:${built[i + 1]!.stage.key}`
        const from = serpentine(i + 1, cols)
        const to = serpentine(i + 2, cols)
        const sides =
          from.row !== to.row
            ? { sourceHandle: 's-b', targetHandle: 't-t' }
            : to.col > from.col
              ? { sourceHandle: 's-r', targetHandle: 't-l' }
              : { sourceHandle: 's-l', targetHandle: 't-r' }
        edges.push({
          id: `${a}->${b}`,
          source: a,
          target: b,
          ...sides,
          markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
        })
      }

      y += containerH + ROW_GAP
    }

    return { nodes, edges }
  },
}

/** A blank canvas reads as "nothing is happening" when the truth is "nothing
 *  is configured", and those want different actions. */
function emptyPipelineNode(): Node {
  const h = stageNodeHeight(0)
  return {
    id: 'stage:none',
    type: 'stage',
    data: {
      ordinal: 0,
      name: '',
      placeholder: 'noStages',
      current: false,
      render: null,
      age: null,
      visited: false,
      visits: 0,
      stale: false,
    } satisfies StageNodeData,
    position: { x: 0, y: 0 },
    width: STAGE_W,
    height: h,
    style: { width: STAGE_W, height: h },
  }
}
