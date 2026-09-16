// URL builders for the Issue Graph HTTP API and deep links.
//
// Deep links deliberately carry NO filter params. They used to force
// `active=0` + `state=<all six types>`, because the app's filter defaults are
// not neutral and a completed/canceled issue would otherwise fail to render
// with the camera landing on nothing. The app now handles that itself: the
// focused issue is exempt from filtering (applyFilters' `alwaysInclude`), and
// a link carrying no filter params leaves the user's own filters in place
// instead of resetting them (urlSync's `preserveFiltersOnFocus`). Adding a
// filter param back here would opt out of both.

/** Strip a trailing slash so we can append paths predictably. */
export function normalizeBaseUrl(raw: string | undefined): string {
  const trimmed = (raw ?? "").trim() || "http://localhost:31415";
  return trimmed.replace(/\/+$/, "");
}

/**
 * Custom-scheme deep link the OS routes straight to the installed PWA (the PWA
 * equivalent of Linear's `linear://`). Requires the PWA to be (re)installed with
 * the `web+issuegraph` protocol_handler. Opened with no `application` so macOS
 * routes the scheme to its registered handler.
 */
export function protocolUrl(
  identifier: string,
  workspaceId?: string,
  mode?: "chain",
): string {
  const host = workspaceId ? `${workspaceId}/` : "";
  const query = mode ? `?mode=${mode}` : "";
  return `web+issuegraph://${host}${identifier}${query}`;
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
 * `POST` target that forces a fresh pull from the upstream backend for one
 * workspace. Workspace-scoped via the same `?w=` middleware as the graph —
 * omit `workspaceId` only in legacy (single-workspace) mode.
 */
export function syncEndpoint(baseUrl: string, workspaceId?: string): string {
  const u = new URL(`${baseUrl}/api/sync`);
  if (workspaceId) u.searchParams.set("w", workspaceId);
  return u.toString();
}

/**
 * Deep link that pans to + highlights `identifier` (regardless of its status —
 * the app exempts the focused issue from its filters) and opens its detail
 * panel (`detail=1`).
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
  return u.toString();
}
