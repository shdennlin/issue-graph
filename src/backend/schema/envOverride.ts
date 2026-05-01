// Layer 2 — env-var overrides. PRD §8.2.
// PRIMARY_GROUP, TYPE_GROUP names are passed to detectSchema directly.
// TYPE_ICONS is a JSON map applied client-side; this module just parses+exposes it.

import { loadConfig } from '../lib/env.js'

export interface TypeIconMap {
  [typeLabelName: string]: string
}

export const DEFAULT_TYPE_ICONS: TypeIconMap = {
  Bug: '🐛',
  Feature: '✨',
  Improvement: '⚡',
  Refactor: '🔧',
  Chore: '🧹',
  Documentation: '📝',
  Testing: '🧪',
  Observability: '📊',
}

export function loadTypeIcons(): TypeIconMap {
  const cfg = loadConfig()
  if (!cfg.TYPE_ICONS) return DEFAULT_TYPE_ICONS
  try {
    const parsed = JSON.parse(cfg.TYPE_ICONS) as Record<string, string>
    return { ...DEFAULT_TYPE_ICONS, ...parsed }
  } catch {
    return DEFAULT_TYPE_ICONS
  }
}
