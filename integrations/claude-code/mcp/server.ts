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
// The SessionStart hook injects nothing today \u2014 it reports presence and
// prints no context \u2014 so every read an agent needs comes through here. An
// earlier version of this comment claimed otherwise, describing the plan
// rather than the code; believing it means leaving out a read on the grounds
// that something else already supplied it.
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
  /** Everything that belongs on this stage — ONE list. Whether the app fills a
   *  name by itself is a property of the name (see AUTO below), not a second
   *  category. It used to be two lists and `ci` was legal in both. */
  fields: string[]
}

/** Names the app fills by itself, by reading somewhere else. Mirrors
 *  `shared/fields.ts` AUTO_FIELDS — re-declared because integrations are
 *  standalone packages outside the root build (the raycast precedent). */
const AUTO: Record<string, string> = {
  issue: 'A member issue, drawn on the stage its Linear state maps to.',
  session: 'A Claude Code session running on a member issue, reported by the hook plugin.',
  pr: 'A pull request Linear has linked to a member issue, across repositories.',
  spec: 'A design doc the scanner linked to a member issue.',
  note: "This stage's own note — what this step is waiting on.",
  ci: 'A check run. Nothing fetches these yet, so today only attached ones appear.',
  blocker: 'An unfinished issue blocking a member, including ones outside the workstream.',
}

/** What a field NAME means in this workspace. Written by a person once, and
 *  resolved into `list_stages` below so an agent learns the name and its
 *  meaning in one call rather than knowing what to call a field and not what
 *  to put in it. */
interface FieldDescription {
  name: string
  description: string
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
        "The workspace's lifecycle, in pipeline order. Each stage carries `states` (the Linear states whose issues belong to it) and `fields` — ONE list of everything that belongs on that stage.\n\nEach field is `{name, auto, description?}`. `auto: true` means the app fills it by itself, by reading somewhere else, and there is nothing for you to attach under that name. `auto: false` means nothing will appear under it unless somebody attaches something — those are the ones to read before calling attach_to_stage. `description` is what this workspace means by the name and therefore what belongs in it; absent means nobody has defined it yet, not that it matters less.\n\nUse the name exactly as given: that is what keeps one field from becoming five spellings of itself across five workstreams.",
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'describe_field',
      description:
        "Write down what a field NAME means in this workspace \u2014 one sentence, stored once and resolved onto every stage that lists the name. Without it a stage says `ledger` and nothing anywhere says what a ledger entry is, so each caller invents its own answer.\n\nThe description is the field's acceptance criterion, so write what makes it SATISFIED (\"the pasted output of make check\"), not what it is about (\"tests\"). Say what a legitimate absence looks like if there is one. A description already written by a person is a decision, not a draft: read list_stages first and leave it alone unless asked.\n\nAn empty description deletes the definition.",
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description:
              'The field name, exactly as a stage lists it. Normalised the same way everywhere, so `Pull Request` and `pull-request` are one field.',
          },
          description: { type: 'string', description: 'One sentence. Empty removes the definition.' },
        },
        required: ['name', 'description'],
      },
    },
    {
      name: 'create_stage',
      description:
        "Add a stage to the end of the workspace's pipeline. Use this to build a lifecycle from a description of how the team actually works \u2014 call list_linear_states first, because `states` must name states this workspace has.\n\nThe pipeline is a shared convention a person reads, so build it when asked and leave it alone otherwise: it is not somewhere to record what you happened to attach.",
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'What happens at this step, in a word or two.' },
          states: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Linear state names whose issues belong here, from list_linear_states. Empty means this stage never conflicts with a state.',
          },
          fields: {
            type: 'array',
            items: { type: 'string' },
            description:
              "What belongs on this stage. Automatic names (issue, session, pr, spec, note, blocker, ci) are filled by the app; any other name is one somebody attaches. Omit it and the stage gets ['issue','note'].",
          },
          nextCommand: { type: 'string', description: 'What is usually run here. A hint, never executed.' },
          staleAfterDays: {
            type: 'number',
            description: 'Days here before it is worth a nudge. Omit for never \u2014 the honest setting for a step that legitimately runs for weeks.',
          },
        },
        required: ['name'],
      },
    },
    {
      name: 'update_stage',
      description:
        'Change one stage. Only the properties you pass are touched. Renaming `key` orphans any workstream pointing at the old one (they read as unknown until it is renamed back), so prefer changing `name`.',
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'The stage to change, from list_stages.' },
          name: { type: 'string' },
          states: { type: 'array', items: { type: 'string' } },
          fields: { type: 'array', items: { type: 'string' } },
          nextCommand: { type: 'string' },
          staleAfterDays: { type: 'number' },
        },
        required: ['key'],
      },
    },
    {
      name: 'delete_stage',
      description:
        'Remove a stage. Workstreams sitting on it are left alone and read as an unknown stage until it is re-created \u2014 recoverable, but they disappear from the pipeline meanwhile, so the reply says how many were standing there.',
      inputSchema: {
        type: 'object',
        properties: { key: { type: 'string' } },
        required: ['key'],
      },
    },
    {
      name: 'reorder_stages',
      description:
        'Set the pipeline order. Pass EVERY existing key exactly once \u2014 a partial list is refused rather than interleaved with the current order, because a caller working from a stale read would otherwise silently reshuffle stages it never saw.',
      inputSchema: {
        type: 'object',
        properties: { keys: { type: 'array', items: { type: 'string' } } },
        required: ['keys'],
      },
    },
    {
      name: 'list_workstreams',
      description:
        'Every workstream (a feature in flight: its issues, their progress, and who holds what). Each carries `summary`, the first line of its note \u2014 what it is for.\n\nArchived ones are off the board by default, which is what archiving meant. Pass includeArchived when you are looking FOR one: a filter must not make a workstream you were asked about unreachable.',
      inputSchema: {
        type: 'object',
        properties: {
          includeArchived: { type: 'boolean', description: 'Include archived workstreams too.' },
        },
      },
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
          // NOT an enum. A kind is a free lowercase slug, and an enum here
          // would have a schema-validating client reject the very names the
          // description tells the agent to invent — `runbook`, `incident` —
          // and even `ci` and `issue`, which this app draws richly.
          kind: {
            type: 'string',
            description:
              "Any short lowercase slug. 'spec' | 'pr' | 'ci' | 'issue' | 'url' render richly; anything else renders as a labelled row carrying its kind.",
          },
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
        'Rename a workstream, describe it, archive it, and/or add and remove issues. Removing an issue drops its claim and progress with it.\n\nArchiving is the way to retire a workstream: it leaves the record and its stage history intact, which delete_workstream does not. Prefer it unless asked to delete.',
      inputSchema: {
        type: 'object',
        properties: {
          workstreamId: { type: 'number' },
          name: { type: 'string' },
          note: {
            type: 'string',
            description:
              'What this workstream is for, in the words whoever picks it up needs \u2014 this is the one place a person or an agent can say why it exists. Empty clears it.',
          },
          status: {
            type: 'string',
            enum: ['active', 'archived'],
            description: 'Archived workstreams drop out of the board but keep their history.',
          },
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
        // Two requests, one tool call. Splitting them into two tools would
        // make the descriptions optional in practice: an agent that can match
        // a field name has no reason to suspect a second lookup exists, so the
        // definitions would go unread by exactly the caller they are for.
        const [r, f] = await Promise.all([
          call<{ entries: LifecycleStage[] }>('/api/lifecycle'),
          call<{ entries: FieldDescription[] }>('/api/fields'),
        ])
        const meaning = new Map(f.entries.map((e) => [e.name, e.description]))
        return text(
          r.entries.map((s) => ({
            ...s,
            fields: s.fields.map((name) => {
              // The workspace's own sentence wins over the app's built-in one:
              // a team that has written down what `spec` means here knows
              // something the app does not.
              const description = meaning.get(name) ?? AUTO[name]
              return {
                name,
                // `auto: true` means the app already fills it and there is
                // nothing for you to attach. `false` means nothing will appear
                // under this name unless somebody attaches it.
                auto: name in AUTO,
                ...(description === undefined ? {} : { description }),
              }
            }),
          })),
        )
      }

      case 'describe_field': {
        // PUT, not PATCH: one field has one sentence, and the server treats an
        // empty one as a delete so a cleared definition leaves no row claiming
        // the field means nothing.
        const name = String(a.name ?? '')
        const description = String(a.description ?? '')
        const r = await call<{ name: string; description: string } | undefined>(
          `/api/fields/${encodeURIComponent(name)}`,
          { method: 'PUT', body: JSON.stringify({ description }) },
        )
        return text(r === undefined ? `${name}: definition removed` : r)
      }

      case 'create_stage': {
        const body: Record<string, unknown> = { name: String(a.name ?? '') }
        // Only what was passed: an omitted `fields` has to stay omitted so the
        // server applies its default, which an empty array would suppress.
        for (const k of ['states', 'fields', 'nextCommand', 'staleAfterDays']) {
          if (a[k] !== undefined) body[k] = a[k]
        }
        return text(await call<unknown>('/api/lifecycle', { method: 'POST', body: JSON.stringify(body) }))
      }

      case 'update_stage': {
        const key = String(a.key ?? '')
        const stages = await call<{ entries: (LifecycleStage & { id: number })[] }>('/api/lifecycle')
        const stage = stages.entries.find((s) => s.key === key)
        if (!stage) return text(`no stage with key ${key}`)
        const patch: Record<string, unknown> = {}
        for (const k of ['name', 'states', 'fields', 'nextCommand', 'staleAfterDays']) {
          if (a[k] !== undefined) patch[k] = a[k]
        }
        if (Object.keys(patch).length === 0) return text('nothing to change')
        await call(`/api/lifecycle/${stage.id}`, { method: 'PATCH', body: JSON.stringify(patch) })
        return text(`${key}: ${Object.keys(patch).join(', ')} updated`)
      }

      case 'delete_stage': {
        const key = String(a.key ?? '')
        const [stages, batches] = await Promise.all([
          call<{ entries: (LifecycleStage & { id: number })[] }>('/api/lifecycle'),
          call<{ entries: { stage: string | null }[] }>('/api/batches'),
        ])
        const stage = stages.entries.find((s) => s.key === key)
        if (!stage) return text(`no stage with key ${key}`)
        // Counted and reported rather than refused. Deleting is recoverable —
        // re-creating the key brings them back — but a caller that did not know
        // it was moving four workstreams off the board should hear about it.
        const standing = batches.entries.filter((b) => b.stage === key).length
        await call(`/api/lifecycle/${stage.id}`, { method: 'DELETE' })
        return text(
          standing === 0
            ? `${key} deleted`
            : `${key} deleted. ${standing} workstream(s) were on it and now read as an unknown stage; re-creating the key restores them.`,
        )
      }

      case 'reorder_stages': {
        await call('/api/lifecycle/reorder', {
          method: 'POST',
          body: JSON.stringify({ keys: a.keys }),
        })
        return text('reordered')
      }

      case 'list_workstreams': {
        const r = await call<{ entries: unknown[] }>(
          a.includeArchived === true ? '/api/batches?status=all' : '/api/batches',
        )
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
        // One PATCH for everything the row itself holds. The server treats an
        // absent key as "leave alone" and an explicit null as "clear", so an
        // empty note has to travel as null rather than as ''.
        const patch: Record<string, unknown> = {}
        if (typeof a.name === 'string' && a.name.trim()) {
          patch.name = a.name
          done.push(`renamed to "${a.name}"`)
        }
        if (typeof a.note === 'string') {
          patch.note = a.note.trim() === '' ? null : a.note
          done.push(a.note.trim() === '' ? 'note cleared' : 'note set')
        }
        if (typeof a.status === 'string') {
          patch.status = a.status
          done.push(a.status === 'archived' ? 'archived' : 'reactivated')
        }
        if (Object.keys(patch).length > 0) {
          await call(`/api/batches/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
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
