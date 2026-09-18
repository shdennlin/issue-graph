// issue-graph MCP server — a thin stdio adapter over the server's HTTP API.
//
// Deliberately thin. Every rule it appears to enforce actually lives in the
// server (stage compatibility in lifecycleStore.ts, batch ordering and claim
// eligibility in batchStore.ts), so this file only translates tool calls into
// requests. Two callers implementing the same rules is how they drift.
//
// THE HARD BOUNDARY: this server reads anything and writes ONLY issue-graph's
// own data — stage assignments and batch claims. It never moves a Linear state.
// Those transitions belong to Linear's own MCP or its GitHub automation, and a
// second writer on that field is the failure this whole design is shaped to
// avoid. See docs/adr/0002-lifecycle-stage-is-stored-not-derived.md.
//
// Most reads an agent needs are already injected by the SessionStart hook, so
// what is genuinely irreducible here is the INTERACTIVE part: asking for the
// next issue out of a batch, which cannot be answered once at session start.
//
// Types are re-declared rather than imported from @shared. That is the
// convention for this repo's integrations (see integrations/raycast/src/lib/
// types.ts): they are standalone packages outside the root build, with no path
// aliases and no shared tsconfig.

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

const BASE = (process.env.ISSUE_GRAPH_URL ?? '').replace(/\/+$/, '')
const TOKEN = process.env.ISSUE_GRAPH_TOKEN ?? ''
const WORKSPACE = process.env.ISSUE_GRAPH_WORKSPACE ?? ''

if (!BASE) {
  // stderr, never stdout: stdout is the JSON-RPC channel and any stray byte on
  // it corrupts the protocol.
  process.stderr.write('[issue-graph] ISSUE_GRAPH_URL is not set — no tools will work\n')
}

interface LifecycleStage {
  key: string
  name: string
  sortOrder: number
  states: string[]
  nextCommand: string | null
  /** Projections this stage draws — what it READS, not what you write to it. */
  shows: string[]
  /** Attachment kinds this stage EXPECTS — what to hang on it. Advisory. */
  fields: string[]
}

/** Append the workspace selector the server's middleware reads from `?w=`. */
function url(path: string): string {
  if (!WORKSPACE) return `${BASE}${path}`
  return `${BASE}${path}${path.includes('?') ? '&' : '?'}w=${encodeURIComponent(WORKSPACE)}`
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  if (!BASE) throw new Error('ISSUE_GRAPH_URL is not set')
  const res = await fetch(url(path), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`${init?.method ?? 'GET'} ${path} → ${res.status} ${body.slice(0, 300)}`)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

const text = (value: unknown) => ({
  content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
})

const server = new Server(
  { name: 'issue-graph', version: '0.1.0' },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'list_stages',
      description:
        "The workspace's lifecycle, in pipeline order. Each stage carries `states` (the Linear states whose issues belong to it), `shows` (what it draws from projections) and `fields` — the attachment kinds it EXPECTS. Read `fields` before attaching: a stage declaring ['ci','runbook'] is telling you the names to use, and using them is what keeps one field from becoming five spellings of itself across five workstreams.",
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'list_workstreams',
      description:
        'Every workstream (a feature in flight: its issues, their progress, and who holds what).',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'get_workstream',
      description:
        'One workstream in detail: its issues in dependency order, each with its stage, who is working on it, and what is blocking it.',
      inputSchema: {
        type: 'object',
        properties: { workstreamId: { type: 'number' } },
        required: ['workstreamId'],
      },
    },
    {
      name: 'create_workstream',
      description:
        'Group issues into a workstream so they can be tracked and worked as one feature.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'What this feature is, in a few words.' },
          members: { type: 'array', items: { type: 'string' }, description: 'e.g. ["ONE-1","ONE-2"]' },
        },
        required: ['name', 'members'],
      },
    },
    {
      name: 'set_workstream_stage',
      description:
        'Move a workstream to a pipeline stage — the trigger that advances a feature. May move backwards (CI went red); pass null to clear. Does NOT touch any Linear state: use the Linear MCP for that.',
      inputSchema: {
        type: 'object',
        properties: {
          workstreamId: { type: 'number' },
          stageKey: { type: 'string', description: 'A key from list_stages; null clears it.' },
        },
        required: ['workstreamId', 'stageKey'],
      },
    },
    {
      name: 'set_stage_note',
      description:
        "A note on one stage of one workstream — the spec folders at Spec review, a decision at Result review. Any stage, any time, not only the current one. Pass `append` to add a line without overwriting what a person wrote; pass `body` to replace it.",
      inputSchema: {
        type: 'object',
        properties: {
          workstreamId: { type: 'number' },
          stageKey: { type: 'string' },
          body: { type: 'string' },
          append: { type: 'string' },
        },
        required: ['workstreamId', 'stageKey'],
      },
    },
    {
      name: 'attach_to_stage',
      description:
        "Attach a field to a stage. `kind` is a FREE LABEL, not a fixed list: any short lowercase slug works, so give the field the name that describes it — 'runbook', 'incident', 'design', whatever this workstream needs. It is stored and displayed under that name.\n\nCheck the stage's own `fields` from list_stages FIRST — those are the names this stage expects, and matching them is how one field stays one field. Five kinds are drawn specially, so prefer them when they fit: 'spec' (a path, shown with the scanned design docs), 'pr' (a pull request URL, shown beside the ones Linear linked itself), 'ci' (a check run), 'issue' (a ticket that matters at this stage without being a member of the workstream) and 'url' (a plain link, with no name shown). Anything else renders as a labelled row carrying its kind — which is a first-class outcome, not a fallback.\n\nEverything attached this way shows a 'manual' mark. Where an upstream link COULD exist — a `Linear:` line in the spec, an issue id in the PR body — fixing it there is better, because the item then appears on its own and stays correct.",
      inputSchema: {
        type: 'object',
        properties: {
          workstreamId: { type: 'number' },
          stageKey: { type: 'string' },
          kind: { type: 'string', enum: ['spec', 'pr', 'url'] },
          value: { type: 'string' },
          label: { type: 'string' },
        },
        required: ['workstreamId', 'stageKey', 'kind', 'value'],
      },
    },
    {
      name: 'list_linear_states',
      description:
        "Every Linear workflow state this workspace has. Needed to fill a stage's `states` when designing a lifecycle.",
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'find_related',
      description:
        'What hangs together with an issue: its blocks chain (both directions) and the design-doc changes linked to it, plus the other issues those changes reach. Use it after finding an issue with the Linear MCP, to decide what belongs in a workstream. Not an issue search — Linear does that better.',
      inputSchema: {
        type: 'object',
        properties: { identifier: { type: 'string' } },
        required: ['identifier'],
      },
    },
    {
      name: 'update_workstream',
      description:
        'Rename a workstream, and/or add and remove issues. Removing an issue drops its claim and progress with it.',
      inputSchema: {
        type: 'object',
        properties: {
          workstreamId: { type: 'number' },
          name: { type: 'string' },
          add: { type: 'array', items: { type: 'string' } },
          remove: { type: 'array', items: { type: 'string' } },
        },
        required: ['workstreamId'],
      },
    },
    {
      name: 'delete_workstream',
      description: 'Delete a workstream. The issues themselves are untouched.',
      inputSchema: {
        type: 'object',
        properties: { workstreamId: { type: 'number' } },
        required: ['workstreamId'],
      },
    },
    {
      name: 'next_issue',
      description:
        'Claim the next issue from a workstream. Respects dependency order — a blocker is always handed out before what it blocks — and will not hand you an issue another session holds.',
      inputSchema: {
        type: 'object',
        properties: {
          workstreamId: { type: 'number' },
          claimant: { type: 'string', description: 'This session id.' },
        },
        required: ['workstreamId', 'claimant'],
      },
    },
    {
      name: 'report_done',
      description:
        'Mark a claimed workstream issue finished, unblocking whatever depended on it. Only the session holding the claim may do this.',
      inputSchema: {
        type: 'object',
        properties: {
          workstreamId: { type: 'number' },
          identifier: { type: 'string' },
          claimant: { type: 'string' },
        },
        required: ['workstreamId', 'identifier', 'claimant'],
      },
    },
  ],
}))

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const a = (req.params.arguments ?? {}) as Record<string, unknown>
  try {
    switch (req.params.name) {
      case 'list_stages': {
        const r = await call<{ entries: LifecycleStage[] }>('/api/lifecycle')
        return text(r.entries)
      }

      case 'list_workstreams': {
        const r = await call<{ entries: unknown[] }>('/api/batches')
        return text(r.entries)
      }

      case 'get_workstream': {
        // The stage belongs to the workstream itself, so there is nothing to
        // join per member — an issue carries only its Linear state.
        return text(await call<unknown>(`/api/batches/${Number(a.workstreamId)}`))
      }

      case 'create_workstream': {
        const r = await call<unknown>('/api/batches', {
          method: 'POST',
          body: JSON.stringify({ name: String(a.name ?? ''), members: a.members }),
        })
        return text(r)
      }

      case 'update_workstream': {
        const id = Number(a.workstreamId)
        const done: string[] = []
        if (typeof a.name === 'string' && a.name.trim()) {
          await call(`/api/batches/${id}`, { method: 'PATCH', body: JSON.stringify({ name: a.name }) })
          done.push(`renamed to "${a.name}"`)
        }
        if (Array.isArray(a.add) && a.add.length > 0) {
          await call(`/api/batches/${id}/members`, {
            method: 'POST',
            body: JSON.stringify({ members: a.add }),
          })
          done.push(`added ${a.add.join(', ')}`)
        }
        for (const m of Array.isArray(a.remove) ? a.remove : []) {
          await call(`/api/batches/${id}/members/${String(m).toUpperCase()}`, { method: 'DELETE' })
          done.push(`removed ${String(m).toUpperCase()}`)
        }
        return text(done.length > 0 ? done.join('; ') : 'nothing to change')
      }

      case 'set_workstream_stage': {
        const stageKey = a.stageKey === null ? null : String(a.stageKey ?? '')
        await call(`/api/batches/${Number(a.workstreamId)}`, {
          method: 'PATCH',
          body: JSON.stringify({ stage: stageKey }),
        })
        return text(`workstream ${Number(a.workstreamId)} → ${stageKey ?? '(no stage)'}`)
      }

      case 'set_stage_note': {
        const payload =
          a.append !== undefined ? { append: String(a.append) } : { body: String(a.body ?? '') }
        await call(
          `/api/batches/${Number(a.workstreamId)}/notes/${encodeURIComponent(String(a.stageKey))}`,
          { method: 'PUT', body: JSON.stringify(payload) },
        )
        return text('note saved')
      }

      case 'attach_to_stage': {
        await call(
          `/api/batches/${Number(a.workstreamId)}/links/${encodeURIComponent(String(a.stageKey))}`,
          {
            method: 'POST',
            body: JSON.stringify({ kind: a.kind, value: a.value, label: a.label }),
          },
        )
        return text(
          `attached by hand. If this is a missing upstream link, adding the Linear id to the spec or PR makes it appear on its own and this can be removed.`,
        )
      }

      case 'list_linear_states': {
        const r = await call<{ workflowStates?: { name: string; type: string }[] }>('/api/labels')
        return text((r.workflowStates ?? []).map((w) => w.name))
      }

      case 'find_related': {
        const identifier = String(a.identifier ?? '').toUpperCase()
        const g = await call<{
          data: {
            issues: {
              identifier: string
              title: string
              state: { name: string }
              relations: { type: string; targetIdentifier: string }[]
            }[]
            designdocs?: { name: string; issueIdentifiers: string[]; filePath: string }[]
          }
        }>('/api/graph')
        const issues = g.data.issues
        const byId = new Map(issues.map((i) => [i.identifier, i]))
        if (!byId.has(identifier)) return text(`${identifier} is not in the cache`)

        // Walk `blocks` in both directions — a chain is what hangs together,
        // and which end you started from is an accident of how you searched.
        const chain = new Set<string>([identifier])
        for (let grew = true; grew; ) {
          grew = false
          for (const i of issues) {
            for (const r of i.relations) {
              if (r.type !== 'blocks') continue
              if (chain.has(i.identifier) && !chain.has(r.targetIdentifier)) {
                chain.add(r.targetIdentifier)
                grew = true
              } else if (chain.has(r.targetIdentifier) && !chain.has(i.identifier)) {
                chain.add(i.identifier)
                grew = true
              }
            }
          }
        }

        const changes = (g.data.designdocs ?? []).filter((d) =>
          d.issueIdentifiers.some((id) => chain.has(id)),
        )
        // A change can name issues outside the blocks chain — that is exactly
        // the many-to-many that stops a workstream being one change's shadow.
        const viaChanges = new Set<string>()
        for (const d of changes) for (const id of d.issueIdentifiers) if (!chain.has(id)) viaChanges.add(id)

        const describe = (id: string) => {
          const i = byId.get(id)
          return { identifier: id, title: i?.title ?? null, state: i?.state?.name ?? null }
        }
        return text({
          blocksChain: [...chain].map(describe),
          designDocs: changes.map((d) => ({ name: d.name, path: d.filePath, issues: d.issueIdentifiers })),
          reachedViaDesignDocs: [...viaChanges].map(describe),
        })
      }

      case 'delete_workstream': {
        await call(`/api/batches/${Number(a.workstreamId)}`, { method: 'DELETE' })
        return text(`workstream ${Number(a.workstreamId)} deleted; its issues are untouched`)
      }

      case 'next_issue': {
        const r = await call<{ identifier: string | null; reason?: string }>(
          `/api/batches/${Number(a.workstreamId)}/next`,
          { method: 'POST', body: JSON.stringify({ claimant: String(a.claimant ?? '') }) },
        )
        if (r.identifier === null) {
          // 'done' and 'blocked' are different answers — one means the batch is
          // finished, the other means come back later.
          return text({ ...r, hint: r.reason === 'blocked' ? 'Other sessions hold the unblocked issues; try again shortly.' : undefined })
        }
        return text(r)
      }

      case 'report_done': {
        const r = await call<unknown>(`/api/batches/${Number(a.workstreamId)}/done`, {
          method: 'POST',
          body: JSON.stringify({
            identifier: String(a.identifier ?? '').toUpperCase(),
            claimant: String(a.claimant ?? ''),
          }),
        })
        return text(r)
      }

      default:
        return { ...text(`Unknown tool: ${req.params.name}`), isError: true }
    }
  } catch (e) {
    // Reported as tool output rather than thrown: a server that is down or a
    // token that is wrong is something the agent can read and act on, while a
    // protocol-level error is not.
    return { ...text(`issue-graph: ${e instanceof Error ? e.message : String(e)}`), isError: true }
  }
})

await server.connect(new StdioServerTransport())
