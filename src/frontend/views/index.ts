import { dependencyView } from './dependency'
import { mixView } from './mix'
import { designdocView } from './designdoc'
import type { ViewDefinition } from './types'

// Bucket view removed: redundant with Mix view (which already shows the same
// bucket containers + their issues + cross-bucket blocks edges).
// Timeline view removed: not actually a graph — it was a placeholder for a
// time-series chart that never got built. If a real time-series feature is
// needed later, it should live as its own non-graph component, not pretend to
// be a view.
export const views: ViewDefinition[] = [
  dependencyView,
  mixView,
  designdocView,
]

export function findView(id: string): ViewDefinition | undefined {
  return views.find((v) => v.id === id)
}
