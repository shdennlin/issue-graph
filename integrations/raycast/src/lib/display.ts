import { Color, Icon, type List } from "@raycast/api";
import type { IssueStateType, NormalizedRelation, RelationType } from "./types";

/** Map an issue state type to a tag color, loosely matching Issue Graph's palette. */
export function stateColor(type: IssueStateType): Color {
  switch (type) {
    case "started":
      return Color.Yellow;
    case "completed":
      return Color.Green;
    case "canceled":
      return Color.SecondaryText;
    case "unstarted":
      return Color.Blue;
    case "triage":
      return Color.Orange;
    case "backlog":
    default:
      return Color.SecondaryText;
  }
}

/** Linear priority: 0 none, 1 urgent, 2 high, 3 medium, 4 low. */
export function priorityIcon(priority: number): {
  source: Icon;
  tintColor: Color;
} {
  switch (priority) {
    case 1:
      return { source: Icon.Warning, tintColor: Color.Red };
    case 2:
      return { source: Icon.Circle, tintColor: Color.Orange };
    case 3:
      return { source: Icon.Circle, tintColor: Color.Yellow };
    case 4:
      return { source: Icon.Circle, tintColor: Color.Blue };
    default:
      return { source: Icon.Circle, tintColor: Color.SecondaryText };
  }
}

export function priorityName(priority: number): string {
  switch (priority) {
    case 1:
      return "Urgent";
    case 2:
      return "High";
    case 3:
      return "Medium";
    case 4:
      return "Low";
    default:
      return "None";
  }
}

// --- State grouping ------------------------------------------------------
// Section order puts the issues you act on first (triage/in-progress), then
// the backlog, then the "done" buckets last.
const STATE_ORDER: IssueStateType[] = [
  "triage",
  "started",
  "unstarted",
  "backlog",
  "completed",
  "canceled",
];

const STATE_SECTION_TITLE: Record<IssueStateType, string> = {
  triage: "Triage",
  started: "In Progress",
  unstarted: "Todo",
  backlog: "Backlog",
  completed: "Completed",
  canceled: "Canceled",
};

/** Stable rank for ordering state sections; unknown types sort last. */
export function stateRank(type: IssueStateType): number {
  const i = STATE_ORDER.indexOf(type);
  return i === -1 ? STATE_ORDER.length : i;
}

export function stateSectionTitle(type: IssueStateType): string {
  return STATE_SECTION_TITLE[type] ?? type;
}

// --- Due dates -----------------------------------------------------------
// A due date is only "overdue" for issues that are still open. Completed and
// canceled issues keep their date for reference but never flag red.
function isOpen(type: IssueStateType): boolean {
  return type !== "completed" && type !== "canceled";
}

/** Whole-day delta from local midnight today to the (local) due date. */
function daysUntil(dueDate: string): number | null {
  const due = new Date(`${dueDate}T00:00:00`);
  if (Number.isNaN(due.getTime())) return null;
  const now = new Date();
  const todayMs = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  return Math.round((due.getTime() - todayMs) / 86_400_000);
}

/** Short absolute date, e.g. "Jun 4" or "Jun 4, 2027" if not this year. */
export function formatShortDate(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return null;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** Friendly relative due text + whether it should read as overdue. */
export function dueText(
  dueDate: string,
  stateType: IssueStateType,
): { text: string; overdue: boolean } | null {
  const diff = daysUntil(dueDate);
  if (diff === null) return null;
  const overdue = diff < 0 && isOpen(stateType);
  let text: string;
  if (diff === 0) text = "Today";
  else if (diff === 1) text = "Tomorrow";
  else if (diff === -1) text = "Yesterday";
  else if (diff < 0) text = `${-diff}d overdue`;
  else if (diff <= 7) text = `${diff}d`;
  else text = formatShortDate(dueDate) ?? dueDate;
  return { text, overdue };
}

/** List accessory for an issue's due date, red + warning icon when overdue. */
export function dueAccessory(
  dueDate: string | null | undefined,
  stateType: IssueStateType,
): List.Item.Accessory | null {
  if (!dueDate) return null;
  const d = dueText(dueDate, stateType);
  if (!d) return null;
  return {
    tag: {
      value: d.text,
      color: d.overdue ? Color.Red : Color.SecondaryText,
    },
    icon: d.overdue ? Icon.Warning : Icon.Calendar,
    tooltip: `Due ${formatShortDate(dueDate)}`,
  };
}

// --- Relations -----------------------------------------------------------
const RELATION_LABEL: Record<RelationType, string> = {
  blocks: "Blocks",
  related: "Related",
  duplicate: "Duplicate of",
};

/** Group an issue's relations by type → "ONE-1, ONE-2" target lists. */
export function relationsByType(
  relations: NormalizedRelation[] | undefined,
): { label: string; targets: string }[] {
  if (!relations?.length) return [];
  const order: RelationType[] = ["blocks", "related", "duplicate"];
  return order
    .map((type) => ({
      label: RELATION_LABEL[type],
      targets: relations
        .filter((r) => r.type === type)
        .map((r) => r.targetIdentifier)
        .join(", "),
    }))
    .filter((g) => g.targets.length > 0);
}
