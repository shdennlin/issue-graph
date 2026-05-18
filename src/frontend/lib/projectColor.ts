// Per-project color resolution shared by project view, milestone view, and
// the filter panel color dot — keeps the canvas tint, the milestone view's
// shared parent color, and the filter row's swatch all in lockstep.
//
// Decision priority:
//   1. Linear's real project.color, when set to anything other than Linear's
//      default gray '#bec2c8' (which is what Linear stores when the user
//      never picked a color).
//   2. A deterministic HSL derived from the project id — same project ⇒ same
//      color forever, across reloads and workspaces.

/** Linear's "no color set" default. Treated as absent so two projects that
 *  both never picked a color don't visually collapse into the same tint. */
const LINEAR_DEFAULT_GRAY = '#bec2c8'

/** FNV-1a 32-bit hash. Cheap, deterministic, distributes evenly enough across
 *  short identifiers like Linear project UUIDs. */
function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Derive a stable HSL color for a project id. Saturation + lightness tuned
 *  to read clearly on both light and dark themes without per-theme branching
 *  (most container tints render at ~6-12% opacity anyway, so exact lightness
 *  matters less than hue stability). */
function hashColorFor(projectId: string): string {
  const h = hashString(projectId) % 360
  return `hsl(${h}, 55%, 60%)`
}

/** Resolve the display color for a project. Returns a CSS color string ready
 *  to drop into `--bucket-tint` or `background` properties. */
export function projectColor(
  projectId: string | null | undefined,
  linearColor: string | null | undefined,
  fallback = 'var(--fg-muted)',
): string {
  if (!projectId) return fallback
  if (linearColor && linearColor.toLowerCase() !== LINEAR_DEFAULT_GRAY) {
    return linearColor
  }
  return hashColorFor(projectId)
}
