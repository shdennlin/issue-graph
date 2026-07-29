import {
  Action,
  ActionPanel,
  type Application,
  Color,
  getPreferenceValues,
  Icon,
  List,
  showToast,
  Toast,
} from "@raycast/api";
import { useCachedPromise, useFrecencySorting } from "@raycast/utils";
import { useEffect, useState } from "react";
import {
  dueAccessory,
  formatShortDate,
  priorityIcon,
  priorityName,
  relationsByType,
  relativeTime,
  stateColor,
  stateRank,
  stateSectionTitle,
} from "./lib/display";
import { loadEverything, type IssueRow } from "./lib/issues";
import { syncWorkspaces } from "./lib/sync";
import { chainUrl, focusUrl, normalizeBaseUrl, protocolUrl } from "./lib/url";

interface Preferences {
  baseUrl?: string;
  /** Chosen via the `appPicker` preference; undefined → system default. */
  opener?: Application;
}

const ALL = "all";

export default function Command() {
  const { baseUrl: rawBaseUrl, opener } = getPreferenceValues<Preferences>();
  const baseUrl = normalizeBaseUrl(rawBaseUrl);

  // One fan-out load: workspace list + every workspace's issues, merged and
  // tagged by origin. "All Workspaces" is the default so search spans them all.
  const { data, isLoading, revalidate } = useCachedPromise(
    loadEverything,
    [baseUrl],
    {
      keepPreviousData: true,
      failureToastOptions: {
        title: "Couldn't reach Issue Graph",
        message: baseUrl,
      },
    },
  );

  const profiles = data?.profiles ?? [];
  const rows = data?.rows ?? [];
  const syncs = data?.syncs ?? [];

  // Re-render every 30s so the relative "Synced 3m ago" label in the title
  // bar stays current while the panel sits open. No re-fetch — just a ticker.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  // Frecency: issues you open most often (and most recently) float to the top.
  // `visitItem` is recorded in the open actions below, keyed by the globally
  // unique Linear id so the ranking is stable across workspaces.
  const { data: ranked, visitItem } = useFrecencySorting(rows, {
    key: (i) => i.id,
  });

  const [workspaceFilter, setWorkspaceFilter] = useState<string>(ALL);
  const [showDetail, setShowDetail] = useState(false);

  const multiWorkspace = profiles.length > 1;
  const visible =
    workspaceFilter === ALL
      ? ranked
      : ranked.filter((r) => r.workspaceId === workspaceFilter);

  // Partition into state sections (Triage → In Progress → Todo → Backlog →
  // Completed → Canceled), preserving the frecency order within each section.
  const sections = groupByState(visible);

  // Force a fresh pull from the upstream backend, then revalidate so the list
  // reflects it. Scope follows the workspace dropdown: "All" syncs every
  // profile, a pinned workspace syncs just that one, legacy mode the default.
  async function handleSync() {
    const targets: Array<string | undefined> =
      profiles.length === 0
        ? [undefined]
        : workspaceFilter === ALL
          ? profiles.map((p) => p.id)
          : [workspaceFilter];

    const toast = await showToast({
      style: Toast.Style.Animated,
      title:
        targets.length > 1
          ? `Syncing ${targets.length} workspaces…`
          : "Syncing Issue Graph…",
    });
    try {
      const summary = await syncWorkspaces(baseUrl, targets);
      await revalidate();
      if (summary.failedCount === 0) {
        toast.style = Toast.Style.Success;
        toast.title = `Synced ${summary.issues} issue${summary.issues === 1 ? "" : "s"}`;
      } else {
        toast.style = Toast.Style.Failure;
        toast.title = `Sync failed (${summary.failedCount}/${targets.length})`;
        toast.message = summary.firstError;
      }
    } catch (err) {
      toast.style = Toast.Style.Failure;
      toast.title = "Sync failed";
      toast.message = err instanceof Error ? err.message : String(err);
    }
  }

  // Title-bar freshness. With "All" selected, show the OLDEST workspace sync —
  // everything on screen is at least that fresh; the newest would mask a stale
  // workspace. Pinned to one workspace → that workspace's own sync time.
  const relevantSyncs =
    workspaceFilter === ALL
      ? syncs
      : syncs.filter((s) => s.workspaceId === workspaceFilter);
  const oldestSync = relevantSyncs.reduce<number | null>(
    (min, s) =>
      s.fetchedAt > 0
        ? min === null
          ? s.fetchedAt
          : Math.min(min, s.fetchedAt)
        : min,
    null,
  );
  const syncedLabel = relativeTime(oldestSync);
  const pinnedName =
    workspaceFilter === ALL
      ? null
      : (profiles.find((p) => p.id === workspaceFilter)?.name ?? null);
  const navigationTitle = [
    "Search Issues",
    pinnedName,
    syncedLabel ? `Synced ${syncedLabel}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <List
      navigationTitle={navigationTitle}
      // Raycast's built-in filtering re-ranks by match score once you type, and
      // by default that ranking can reorder whole sections — a Completed issue
      // whose title matches exactly would drag its section above In Progress.
      // keepSectionOrder pins the STATE_ORDER grouping so done work always
      // stays at the bottom; ranking still applies within each section.
      filtering={{ keepSectionOrder: true }}
      isLoading={isLoading}
      isShowingDetail={showDetail && visible.length > 0}
      searchBarPlaceholder="Search by id, title, assignee, or workspace…"
      searchBarAccessory={
        multiWorkspace ? (
          <List.Dropdown
            tooltip="Workspace"
            defaultValue={ALL}
            onChange={setWorkspaceFilter}
          >
            <List.Dropdown.Item
              title="All Workspaces"
              value={ALL}
              icon={Icon.Globe}
            />
            <List.Dropdown.Section title="Workspaces">
              {profiles.map((p) => (
                <List.Dropdown.Item key={p.id} title={p.name} value={p.id} />
              ))}
            </List.Dropdown.Section>
          </List.Dropdown>
        ) : undefined
      }
    >
      {visible.length === 0 ? (
        <List.EmptyView
          icon={Icon.MagnifyingGlass}
          title="No issues"
          description={
            isLoading
              ? "Loading…"
              : `${baseUrl}${syncedLabel ? ` · synced ${syncedLabel}` : ""}`
          }
          actions={
            <ActionPanel>
              <Action
                title="Sync Issue Graph"
                icon={Icon.ArrowClockwise}
                shortcut={{ modifiers: ["cmd"], key: "r" }}
                onAction={handleSync}
              />
            </ActionPanel>
          }
        />
      ) : (
        sections.map((section) => (
          <List.Section
            key={section.type}
            title={section.title}
            subtitle={String(section.rows.length)}
          >
            {section.rows.map((issue) => (
              <IssueItem
                key={issue.id}
                issue={issue}
                baseUrl={baseUrl}
                opener={opener}
                showDetail={showDetail}
                onToggleDetail={() => setShowDetail((v) => !v)}
                onVisit={() => visitItem(issue)}
                onSync={handleSync}
              />
            ))}
          </List.Section>
        ))
      )}
    </List>
  );
}

interface StateSection {
  type: IssueRow["state"]["type"];
  title: string;
  rows: IssueRow[];
}

/** Bucket rows by state type, ordered for action priority, preserving the
 *  incoming (frecency) order inside each bucket. Empty buckets are dropped. */
function groupByState(rows: IssueRow[]): StateSection[] {
  const byType = new Map<IssueRow["state"]["type"], IssueRow[]>();
  for (const row of rows) {
    const list = byType.get(row.state.type);
    if (list) list.push(row);
    else byType.set(row.state.type, [row]);
  }
  return [...byType.entries()]
    .sort(([a], [b]) => stateRank(a) - stateRank(b))
    .map(([type, sectionRows]) => ({
      type,
      title: stateSectionTitle(type),
      rows: sectionRows,
    }));
}

function IssueItem({
  issue,
  baseUrl,
  opener,
  showDetail,
  onToggleDetail,
  onVisit,
  onSync,
}: {
  issue: IssueRow;
  baseUrl: string;
  opener?: Application;
  showDetail: boolean;
  onToggleDetail: () => void;
  onVisit: () => void;
  onSync: () => void;
}) {
  const protoLink = protocolUrl(issue.identifier, issue.workspaceId);
  const protoChainLink = protocolUrl(
    issue.identifier,
    issue.workspaceId,
    "chain",
  );
  const graphLink = focusUrl(baseUrl, issue.identifier, issue.workspaceId);
  const chainLink = chainUrl(baseUrl, issue.identifier, issue.workspaceId);
  // Label the browser-routed actions with the chosen app so the panel reads
  // "Open in Browser (Chrome)" etc. when an opener is set.
  const suffix = opener ? ` (${opener.name})` : "";

  // No workspace tag: the identifier prefix (ONE-/VER-) already conveys it.
  // workspaceName stays in `keywords` so search-by-workspace still works.
  // In detail mode Raycast collapses the list to title+icon and hides these.
  const accessories: List.Item.Accessory[] = [];
  const due = dueAccessory(issue.dueDate, issue.state.type);
  if (due) accessories.push(due);
  accessories.push({
    tag: { value: issue.state.name, color: stateColor(issue.state.type) },
  });
  if (issue.assignee?.displayName) {
    accessories.push({
      icon: issue.assignee.avatarUrl ?? Icon.Person,
      text: issue.assignee.displayName,
    });
  }

  return (
    <List.Item
      title={issue.identifier}
      subtitle={issue.title}
      keywords={[
        issue.title,
        issue.state.name,
        issue.assignee?.displayName ?? "",
        issue.workspaceName,
      ].filter(Boolean)}
      icon={priorityIcon(issue.priority)}
      accessories={accessories}
      detail={<IssueDetail issue={issue} />}
      actions={
        <ActionPanel>
          {/* Primary: custom scheme → OS routes straight to the installed PWA
              (requires the PWA reinstalled with the web+issuegraph handler).
              No `application` so macOS uses the scheme's registered handler. */}
          <Action.Open
            title="Open in Issue Graph (PWA)"
            target={protoLink}
            icon={Icon.Network}
            onOpen={onVisit}
          />
          <Action.Open
            title={`Open in Browser${suffix}`}
            target={graphLink}
            application={opener}
            icon={Icon.Globe}
            shortcut={{ modifiers: ["opt"], key: "enter" }}
            onOpen={onVisit}
          />
          <Action.Open
            title="Open in Chain Mode (PWA)"
            target={protoChainLink}
            icon={Icon.Link}
            shortcut={{ modifiers: ["cmd", "shift"], key: "enter" }}
            onOpen={onVisit}
          />
          {/* Browser fallbacks so the extension works even with no PWA
              installed (the web+issuegraph:// scheme has no handler then). */}
          <Action.Open
            title={`Open Chain in Browser${suffix}`}
            target={chainLink}
            application={opener}
            icon={Icon.Link}
            shortcut={{ modifiers: ["opt", "cmd"], key: "enter" }}
            onOpen={onVisit}
          />
          {issue.url ? (
            <Action.Open
              title={`Open in Linear${suffix}`}
              target={issue.url}
              application={opener}
              icon={{ source: Icon.Link, tintColor: Color.Purple }}
              shortcut={{ modifiers: ["cmd"], key: "enter" }}
            />
          ) : null}
          <ActionPanel.Section>
            <Action
              title={showDetail ? "Hide Details" : "Show Details"}
              icon={Icon.Sidebar}
              shortcut={{ modifiers: ["cmd"], key: "d" }}
              onAction={onToggleDetail}
            />
            <Action.CopyToClipboard
              title="Copy Identifier"
              content={issue.identifier}
              shortcut={{ modifiers: ["cmd"], key: "." }}
            />
            <Action.CopyToClipboard
              title="Copy Issue Graph Link"
              content={graphLink}
              shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
            />
            <Action.CopyToClipboard
              title="Copy Markdown Link"
              content={`[${issue.identifier}](${graphLink})`}
              shortcut={{ modifiers: ["cmd", "shift"], key: "m" }}
            />
          </ActionPanel.Section>
          <ActionPanel.Section>
            <Action
              title="Sync Issue Graph"
              icon={Icon.ArrowClockwise}
              shortcut={{ modifiers: ["cmd"], key: "r" }}
              onAction={onSync}
            />
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}

/** Right-hand metadata panel (toggled with ⌘D). Renders fields already present
 *  in the loaded payload — no extra network calls. */
function IssueDetail({ issue }: { issue: IssueRow }) {
  const M = List.Item.Detail.Metadata;
  const labels = issue.labels ?? [];
  const relations = relationsByType(issue.relations);
  const due = issue.dueDate
    ? (formatShortDate(issue.dueDate) ?? issue.dueDate)
    : null;

  // Metadata-only (no `markdown`): when both are supplied Raycast splits the
  // pane in half and crams metadata into the bottom — leaving a big empty gap.
  // Dropping markdown lets metadata own the full height, so more rows show and
  // they start at the top. The title lives in the first row instead.
  return (
    <List.Item.Detail
      metadata={
        <M>
          <M.Label title={issue.identifier} text={issue.title} />
          <M.Separator />
          <M.TagList title="Status">
            <M.TagList.Item
              text={issue.state.name}
              color={stateColor(issue.state.type)}
            />
          </M.TagList>
          <M.Label
            title="Priority"
            text={priorityName(issue.priority)}
            icon={priorityIcon(issue.priority)}
          />
          <M.Label
            title="Assignee"
            text={issue.assignee?.displayName ?? "Unassigned"}
            icon={Icon.Person}
          />
          {due ? <M.Label title="Due" text={due} icon={Icon.Calendar} /> : null}
          {issue.estimate != null ? (
            <M.Label title="Estimate" text={String(issue.estimate)} />
          ) : null}
          <M.Separator />
          {issue.project ? (
            <M.Label
              title="Project"
              text={issue.project.name}
              icon={{
                source: Icon.Circle,
                tintColor: issue.project.color ?? Color.SecondaryText,
              }}
            />
          ) : null}
          {issue.projectMilestone ? (
            <M.Label title="Milestone" text={issue.projectMilestone.name} />
          ) : null}
          {issue.cycle ? (
            <M.Label title="Cycle" text={`Cycle ${issue.cycle.number}`} />
          ) : null}
          {issue.team ? <M.Label title="Team" text={issue.team.name} /> : null}
          {labels.length > 0 ? (
            <M.TagList title="Labels">
              {labels.map((l) => (
                <M.TagList.Item key={l.id} text={l.name} color={l.color} />
              ))}
            </M.TagList>
          ) : null}
          {(relations.length > 0 ||
            issue.parent ||
            (issue.children?.length ?? 0) > 0 ||
            (issue.commentsCount ?? 0) > 0) && <M.Separator />}
          {relations.map((r) => (
            <M.Label key={r.label} title={r.label} text={r.targets} />
          ))}
          {issue.parent ? <M.Label title="Parent" text={issue.parent} /> : null}
          {issue.children?.length ? (
            <M.Label title="Sub-issues" text={String(issue.children.length)} />
          ) : null}
          {issue.commentsCount ? (
            <M.Label
              title="Comments"
              text={String(issue.commentsCount)}
              icon={Icon.SpeechBubble}
            />
          ) : null}
          {(issue.updatedAt || issue.createdAt) && <M.Separator />}
          {issue.updatedAt ? (
            <M.Label
              title="Updated"
              text={formatShortDate(issue.updatedAt) ?? issue.updatedAt}
            />
          ) : null}
          {issue.createdAt ? (
            <M.Label
              title="Created"
              text={formatShortDate(issue.createdAt) ?? issue.createdAt}
            />
          ) : null}
        </M>
      }
    />
  );
}
