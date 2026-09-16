// Workspace-id rules, mirrored from src/backend/controlStore.ts.
//
// The server re-validates and is the actual boundary — the id becomes a
// directory name, so this copy exists for an immediate message in the form,
// not for safety. Keep the two in step.

const ID_RE = /^[a-z0-9][a-z0-9-]*$/
const MAX_ID_LENGTH = 64
const RESERVED = new Set(['active'])

export function isValidWorkspaceId(id: string): boolean {
  if (id.length === 0 || id.length > MAX_ID_LENGTH) return false
  if (RESERVED.has(id)) return false
  return ID_RE.test(id)
}

/**
 * Suggest a slug from a display name so most users never touch the id field.
 *
 * The slug decides where the workspace's data lives
 * (`data/workspaces/<id>/graph.db`), which is what lets someone re-add a
 * workspace by typing its old id and pick the existing cache back up. That is
 * also why the field stays visible and editable rather than being a hidden
 * generated value — a uuid here would orphan every existing cache.
 *
 * Returns '' when the name has no usable characters; the caller treats that as
 * "not valid yet" rather than substituting something.
 */
export function slugifyWorkspaceName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_ID_LENGTH)
    .replace(/-+$/g, '')
}
