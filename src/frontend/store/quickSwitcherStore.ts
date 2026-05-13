import { create } from 'zustand'
import type { RecentItem } from '../components/quickSwitcher/types'

const STORAGE_KEY = 'issue-graph-quick-switcher-recents'
const MAX_RECENTS = 8

interface PersistedShape {
  version: 1
  recents: RecentItem[]
}

function loadRecents(): RecentItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as PersistedShape
    if (parsed?.version !== 1 || !Array.isArray(parsed.recents)) return []
    return parsed.recents.slice(0, MAX_RECENTS)
  } catch {
    return []
  }
}

function persistRecents(recents: RecentItem[]): void {
  try {
    const shape: PersistedShape = { version: 1, recents }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(shape))
  } catch {
    // Quota / private mode — degrade silently.
  }
}

interface QuickSwitcherState {
  open: boolean
  recents: RecentItem[]
  openPalette: () => void
  closePalette: () => void
  pushRecent: (item: RecentItem) => void
}

export const useQuickSwitcherStore = create<QuickSwitcherState>((set, get) => ({
  open: false,
  recents: loadRecents(),
  openPalette: () => set({ open: true }),
  closePalette: () => set({ open: false }),
  pushRecent: (item) => {
    const filtered = get().recents.filter((r) => r.id !== item.id)
    const next = [item, ...filtered].slice(0, MAX_RECENTS)
    persistRecents(next)
    set({ recents: next })
  },
}))
