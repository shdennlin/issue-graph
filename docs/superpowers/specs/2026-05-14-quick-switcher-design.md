# Global Quick Switcher (Cmd+K)

**Status:** Approved design — ready for implementation plan
**Date:** 2026-05-14

## 1. Goal

Linear-style command palette that lets the user jump to any **issue**, **note**, or **tab** across *all open tabs* using a single keyboard shortcut. Replaces the current "switch tab → Cmd+F → search" multi-step flow for cross-project navigation.

Non-goals (deferred): cross-project search of *unloaded* projects on disk; command/action execution (e.g. "toggle filters"); fuzzy search of settings.

## 2. UX

### Trigger
- **Keyboard:** `Cmd+K` (mac) / `Ctrl+K` (linux/win). Also `Cmd+P` / `Ctrl+P` as alias.
- **Mouse:** compact `QuickSwitcherTrigger` button in `Toolbar.tsx`, rendered with the literal "⌘K" hint label. Placed on the **opposite end** of the toolbar from the existing filter-search input to visually separate "jump" from "narrow current view." Icon-only fallback on narrow viewports.

### Layout
- Centered modal, dimmed backdrop, ~640px wide. Respects theme + global font-size.
- Top: single search input, autofocus.
- Body: scrollable result list grouped by kind in fixed order — **Issues → Notes → Tabs**.
- Each row: kind icon, primary label, scope tag (workspace/project name), secondary muted text (e.g. labels for issues, body snippet for notes).
- Empty query state: **Recents** — last 8 selected items.
- Empty-results state: "No matches" hint.
- No-tabs-open state: "No tabs open" hint.

### Keyboard
| Key | Action |
|---|---|
| `Cmd+K` / `Cmd+P` (and `Ctrl+…` on linux/win) | Open palette (when closed) |
| `Esc` | Close |
| `↑` / `↓` | Move selection |
| `Ctrl+J` / `Ctrl+N` | Move down (alias) |
| `Ctrl+K` / `Ctrl+P` | Move up (alias) |
| `Enter` | Activate selected result |
| `Cmd+Enter` | Open issue in **new tab** (issue results only; no-op otherwise) |

**Shortcut-collision rules:**
- The open-shortcut handler lives in `App.tsx` and only fires when the palette is closed. Once open, the modal owns its own keys.
- Nav aliases (`Ctrl+J/K/N/P`) inside the input require `ctrlKey` only (not `metaKey`) so they don't fight the mac open-shortcut.
- `Ctrl+N` / `Ctrl+P` are `preventDefault`-ed **only while the palette is open and the input has focus**, to avoid breaking browser "new window" / "print" elsewhere.
- IME composition: ignore `Enter` while `e.isComposing`. Matches existing pattern in `InlineSearch.tsx`.

### Activation behavior

| Kind | Enter | Cmd+Enter |
|---|---|---|
| Issue | Switch to issue's tab if needed; select + center node; open detail panel if user pref enabled | Open a **new tab** on the issue's workspace, focus the issue |
| Note | Switch tab if needed; open Notes modal scrolled to that note | (same as Enter) |
| Tab | Switch to that tab | no-op |

Every activation pushes the item onto `recents` (deduped, max 8, persisted in localStorage).

## 3. Architecture

### New files
- `src/frontend/components/QuickSwitcher.tsx` — modal UI, keyboard handling, results list
- `src/frontend/components/quickSwitcher/types.ts` — `Candidate` discriminated union: `{ kind: 'issue' | 'tab' | 'note', id, label, scopeLabel, tabId, payload }`
- `src/frontend/components/quickSwitcher/buildCandidates.ts` — pure: `(tabs, graphsByTab, notesByTab) → Candidate[]`
- `src/frontend/components/quickSwitcher/fuzzyMatch.ts` — small fuzzy scorer (subsequence match + position/word-boundary/prefix bonuses). No new dependency.
- `src/frontend/components/quickSwitcher/QuickSwitcherTrigger.tsx` — toolbar button
- `src/frontend/store/quickSwitcherStore.ts` — `{ open: boolean, recents: RecentItem[], openPalette(), closePalette(), pushRecent(item) }`. `recents` persisted to localStorage.

### Modified files
- `src/frontend/App.tsx` — register `Cmd+K` / `Cmd+P` open-shortcut alongside existing keymap (~lines 430-484); mount `<QuickSwitcher/>` once at root.
- `src/frontend/components/Toolbar.tsx` — add `<QuickSwitcherTrigger/>` opposite the filter-search input.
- `src/frontend/components/ShortcutsModal.tsx` — document new shortcut + nav aliases.

### Data sourcing
On open, build candidates from:
- `useWorkspaceStore` → tabs (+ workspace names → scope labels)
- `useGraphStore` per loaded tab → issues
- `useNotesStore` per tab → notes

Candidates rebuilt **on each open**, not memoized across opens. Graphs are already in memory and bounded; this keeps the store simple and avoids stale indexes.

### Fuzzy match
Subsequence match (chars in order, gaps allowed) with bonuses for:
- Prefix match on label
- Word-boundary hits
- Exact-prefix match on issue ID

Display caps: 50 total, 20 per group.

## 4. Edge cases

- **Tab without a loaded graph yet** (lazy load): include the tab itself as a result; show subtle hint "Open tab to search issues". Do **not** eagerly load graphs — would make `Cmd+K` slow.
- **No tabs open**: "No tabs open" state.
- **Duplicate IDs/titles across projects**: scope tag on every row disambiguates; `tabId` on `Candidate` ensures Enter routes deterministically.
- **Palette open while another modal is open** (Notes, Settings, Shortcuts): palette renders above, returns focus to prior element on close.
- **Browser default `Cmd+K`** (focus URL bar in Chrome): `preventDefault` when handler fires.

## 5. Testing

- **Unit**
  - `fuzzyMatch`: ordering, ties, case-insensitivity, ID-prefix bonus
  - `buildCandidates`: scope tagging, dedup, tabs-without-graph handling
  - `quickSwitcherStore`: recents dedup + max-size + persistence round-trip
- **Component**
  - Opens/closes on `Cmd+K`, `Cmd+P`, `Esc`
  - Arrow + `Ctrl+J/K/N/P` nav
  - `Enter` activates correct handler per kind
  - `Cmd+Enter` opens new tab for issue kind only
  - IME composition does not trigger `Enter` activation
- **Manual**
  - Cross-tab issue jump (switches tab + centers node + optional detail panel)
  - Cmd+Enter on issue opens new tab on the right workspace
  - Theme + font-size variants render correctly
  - Toolbar trigger button click behaves identically to keyboard
  - Narrow viewport: trigger collapses to icon-only

## 6. Out of scope (future)

- Command/action execution layer (run "Toggle filters", "Cycle text size", etc.)
- Indexing unloaded projects on disk
- Server-side search
