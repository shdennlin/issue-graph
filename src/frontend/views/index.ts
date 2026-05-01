import { dependencyView } from './dependency'
import { bucketView } from './bucket'
import { mixView } from './mix'
import { timelineView } from './timeline'
import { designdocView } from './designdoc'
import type { ViewDefinition } from './types'

export const views: ViewDefinition[] = [
  dependencyView,
  bucketView,
  mixView,
  designdocView,
  timelineView,
]

export function findView(id: string): ViewDefinition | undefined {
  return views.find((v) => v.id === id)
}
