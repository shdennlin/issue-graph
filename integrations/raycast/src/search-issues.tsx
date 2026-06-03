import {
  Action,
  ActionPanel,
  type Application,
  Color,
  getPreferenceValues,
  Icon,
  List,
} from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import { useState } from "react";
import { priorityIcon, stateColor } from "./lib/display";
import { loadEverything, type IssueRow } from "./lib/issues";
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
  const { data, isLoading } = useCachedPromise(loadEverything, [baseUrl], {
    keepPreviousData: true,
    failureToastOptions: {
      title: "Couldn't reach Issue Graph",
      message: baseUrl,
    },
  });

  const profiles = data?.profiles ?? [];
  const rows = data?.rows ?? [];
  const [workspaceFilter, setWorkspaceFilter] = useState<string>(ALL);

  const multiWorkspace = profiles.length > 1;
  const visible =
    workspaceFilter === ALL
      ? rows
      : rows.filter((r) => r.workspaceId === workspaceFilter);

  return (
    <List
      isLoading={isLoading}
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
          description={isLoading ? "Loading…" : `Synced from ${baseUrl}`}
        />
      ) : (
        visible.map((issue) => (
          <IssueItem
            key={issue.id}
            issue={issue}
            baseUrl={baseUrl}
            opener={opener}
          />
        ))
      )}
    </List>
  );
}

function IssueItem({
  issue,
  baseUrl,
  opener,
}: {
  issue: IssueRow;
  baseUrl: string;
  opener?: Application;
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
  const accessories: List.Item.Accessory[] = [
    { tag: { value: issue.state.name, color: stateColor(issue.state.type) } },
  ];
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
      actions={
        <ActionPanel>
          {/* Primary: custom scheme → OS routes straight to the installed PWA
              (requires the PWA reinstalled with the web+issuegraph handler).
              No `application` so macOS uses the scheme's registered handler. */}
          <Action.Open
            title="Open in Issue Graph (PWA)"
            target={protoLink}
            icon={Icon.Network}
          />
          <Action.Open
            title={`Open in Browser${suffix}`}
            target={graphLink}
            application={opener}
            icon={Icon.Globe}
            shortcut={{ modifiers: ["opt"], key: "enter" }}
          />
          <Action.Open
            title="Open in Chain Mode (PWA)"
            target={protoChainLink}
            icon={Icon.Link}
            shortcut={{ modifiers: ["cmd", "shift"], key: "enter" }}
          />
          {/* Browser fallbacks so the extension works even with no PWA
              installed (the web+issuegraph:// scheme has no handler then). */}
          <Action.Open
            title={`Open Chain in Browser${suffix}`}
            target={chainLink}
            application={opener}
            icon={Icon.Link}
            shortcut={{ modifiers: ["opt", "cmd"], key: "enter" }}
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
        </ActionPanel>
      }
    />
  );
}
