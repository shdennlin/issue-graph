// URL builders for the Issue Graph HTTP API and deep links.
//
// The deep-link recipe was validated against a live instance: focusing an
// arbitrary issue requires defeating BOTH filters that hide non-active issues —
// the "Active only" quick toggle (`active=0`) AND the explicit state filter
// (`state=<all six types>`). Without both, completed/canceled issues silently
// fail to render and the camera lands on nothing.
const ALL_STATES = "backlog,unstarted,started,triage,completed,canceled";

/** Strip a trailing slash so we can append paths predictably. */
export function normalizeBaseUrl(raw: string | undefined): string {
  const trimmed = (raw ?? "").trim() || "http://localhost:31415";
  return trimmed.replace(/\/+$/, "");
}

export function workspacesEndpoint(baseUrl: string): string {
  return `${baseUrl}/api/workspaces`;
}

export function graphEndpoint(baseUrl: string, workspaceId?: string): string {
  const u = new URL(`${baseUrl}/api/graph`);
  if (workspaceId) u.searchParams.set("w", workspaceId);
  return u.toString();
}

/**
 * Deep link that pans to + highlights `identifier` (regardless of its status)
 * and opens its detail panel (`detail=1`).
 */
export function focusUrl(
  baseUrl: string,
  identifier: string,
  workspaceId?: string,
): string {
  const u = new URL(`${baseUrl}/`);
  if (workspaceId) u.searchParams.set("w", workspaceId);
  u.searchParams.set("focus", identifier);
  u.searchParams.set("detail", "1");
  u.searchParams.set("active", "0");
  u.searchParams.set("state", ALL_STATES);
  return u.toString();
}

/**
 * Deep link that opens `identifier` in chain mode — isolating its combined
 * upstream/downstream dependency chain. Verified live: `chain` takes the human
 * identifier and the workspace MUST be pinned, or the chain root resolves
 * against the wrong workspace's cache and renders "not found".
 */
export function chainUrl(
  baseUrl: string,
  identifier: string,
  workspaceId?: string,
): string {
  const u = new URL(`${baseUrl}/`);
  if (workspaceId) u.searchParams.set("w", workspaceId);
  u.searchParams.set("chain", identifier);
  u.searchParams.set("active", "0");
  u.searchParams.set("state", ALL_STATES);
  return u.toString();
}
