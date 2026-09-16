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
}
interface IssueStage {
  identifier: string
  stageKey: string
  updatedAt: number
  updatedBy: string | null
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
      name: 'get_stage',
      description:
        "Where an issue is in this workspace's lifecycle: its stage, the Linear state, whether those agree, and the command that moves it on.",
      inputSchema: {
        type: 'object',
        properties: { identifier: { type: 'string', description: 'e.g. ONE-393' } },
        required: ['identifier'],
      },
    },
    {
      name: 'list_stages',
      description: "The workspace's lifecycle, in pipeline order.",
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'set_stage',
      description:
        'Record which lifecycle stage an issue is on. This does NOT change the Linear state — use the Linear MCP for that.',
      inputSchema: {
        type: 'object',
        properties: {
          identifier: { type: 'string' },
          stageKey: { type: 'string', description: 'null clears the assignment' },
        },
        required: ['identifier', 'stageKey'],
      },
    },
    {
      name: 'list_batches',
      description: 'Batches of issues queued for agent sessions, with progress.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'next_issue',
      description:
        'Claim the next issue from a batch. Respects dependency order — a blocker is always handed out before what it blocks — and will not hand you an issue another session holds.',
      inputSchema: {
        type: 'object',
        properties: {
          batchId: { type: 'number' },
          claimant: { type: 'string', description: 'This session id.' },
        },
        required: ['batchId', 'claimant'],
      },
    },
    {
      name: 'report_done',
      description:
        'Mark a claimed batch issue finished, unblocking whatever depended on it. Only the session holding the claim may do this.',
      inputSchema: {
        type: 'object',
        properties: {
          batchId: { type: 'number' },
          identifier: { type: 'string' },
          claimant: { type: 'string' },
        },
        required: ['batchId', 'identifier', 'claimant'],
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

      case 'get_stage': {
        const identifier = String(a.identifier ?? '').toUpperCase()
        const [lifecycle, stages, graph] = await Promise.all([
          call<{ entries: LifecycleStage[] }>('/api/lifecycle'),
          call<{ entries: IssueStage[] }>('/api/stage'),
          call<{ data: { issues: { identifier: string; state: { name: string } }[] } }>('/api/graph'),
        ])
        const assignment = stages.entries.find((s) => s.identifier === identifier) ?? null
        const stage = assignment
          ? (lifecycle.entries.find((s) => s.key === assignment.stageKey) ?? null)
          : null
        const issue = graph.data.issues.find((i) => i.identifier === identifier) ?? null
        const stateName = issue?.state?.name ?? null

        // Mirrors lifecycleStore.stageVerdict. `unknown` is not `conflict`: an
        // unstaged issue is unclassified, not in disagreement.
        let verdict: 'ok' | 'conflict' | 'unknown' = 'unknown'
        if (stage) {
          if (stage.states.length === 0) verdict = 'ok'
          else if (stateName) {
            verdict = stage.states.some((s) => s.toLowerCase() === stateName.toLowerCase())
              ? 'ok'
              : 'conflict'
          }
        }

        return text({
          identifier,
          linearState: stateName,
          stage: stage ? { key: stage.key, name: stage.name } : null,
          verdict,
          nextCommand: stage?.nextCommand ?? null,
          ...(verdict === 'conflict'
            ? {
                note: `The stage expects ${stage?.states.join(' / ')} but Linear says "${stateName}". Both are legitimate; issue-graph reports the disagreement and changes neither.`,
              }
            : {}),
        })
      }

      case 'set_stage': {
        const identifier = String(a.identifier ?? '').toUpperCase()
        const stageKey = a.stageKey === null ? null : String(a.stageKey ?? '')
        await call(`/api/stage/${identifier}`, {
          method: 'PUT',
          body: JSON.stringify({ stageKey, updatedBy: 'mcp' }),
        })
        return text(`${identifier} → ${stageKey ?? '(cleared)'}`)
      }

      case 'list_batches': {
        const r = await call<{ entries: unknown[] }>('/api/batches')
        return text(r.entries)
      }

      case 'next_issue': {
        const r = await call<{ identifier: string | null; reason?: string }>(
          `/api/batches/${Number(a.batchId)}/next`,
          { method: 'POST', body: JSON.stringify({ claimant: String(a.claimant ?? '') }) },
        )
        if (r.identifier === null) {
          // 'done' and 'blocked' are different answers — one means the batch is
          // finished, the other means come back later.
          return text({ ...r, hint: r.reason === 'blocked' ? 'Other sessions hold the unblocked issues; try again shortly.' : undefined })
        }
        const stage = await call<{ entries: IssueStage[] }>('/api/stage')
        const assignment = stage.entries.find((s) => s.identifier === r.identifier) ?? null
        return text({ ...r, stageKey: assignment?.stageKey ?? null })
      }

      case 'report_done': {
        const r = await call<unknown>(`/api/batches/${Number(a.batchId)}/done`, {
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
