import { Color, Icon } from "@raycast/api";
import type { IssueStateType } from "./types";

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
