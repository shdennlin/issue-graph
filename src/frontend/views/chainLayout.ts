import type { Edge, Node } from 'reactflow'
import type { NormalizedIssue } from '@shared/types.js'
import type { ViewContext } from './types'
import { dependencyView } from './dependency'

/** Stripe descriptor injected into IssueNodeData when a container view falls
 *  through to dagre layout in chain mode. Drives the 4px left-edge color band
 *  on IssueNode so the user still sees which bucket/project each chain member
 *  belongs to even though the containers themselves have been dissolved. */
export interface ProjectStripeData {
  color: string
  label?: string
}

/** When a container view (mix/project/milestone) is in chain mode, dropping
 *  the container chrome and using dagre flow layout reads dramatically better
 *  than spaghetti edges threading between rectangle buckets. We delegate the
 *  whole layout to dependencyView (same dagre, same connectivity counts, same
 *  cross-view consistency) and then decorate each issue node with a stripe
 *  so the bucket/project identity isn't lost. */
export function buildChainLayout(
  ctx: ViewContext,
  stripeFor: (issue: NormalizedIssue) => ProjectStripeData | null,
): { nodes: Node[]; edges: Edge[] } {
  const base = dependencyView.build(ctx)
  const issueById = new Map<string, NormalizedIssue>()
  for (const i of ctx.data.issues) issueById.set(i.identifier, i)
  const decorated: Node[] = base.nodes.map((n) => {
    if (n.type !== 'issue') return n
    const issue = issueById.get(n.id)
    if (!issue) return n
    const stripe = stripeFor(issue)
    if (!stripe) return n
    return {
      ...n,
      data: { ...(n.data as Record<string, unknown>), projectStripe: stripe },
    }
  })
  return { nodes: decorated, edges: base.edges }
}
