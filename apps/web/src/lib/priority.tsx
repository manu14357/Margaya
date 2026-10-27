import {
  ChevronDown,
  ChevronsUp,
  ChevronUp,
  CircleAlert,
  Minus,
} from "lucide-react";

// Hues come from `--priority-*` in styles/semantic-colors.css.
export function getPriorityIcon(priority: string) {
  switch (priority) {
    case "urgent":
      return (
        <CircleAlert className="h-[12px] w-[12px] text-(--priority-urgent)" />
      );
    case "high":
      return (
        <ChevronsUp className="h-[12px] w-[12px] text-(--priority-high)" />
      );
    case "medium":
      return (
        <ChevronUp className="h-[12px] w-[12px] text-(--priority-medium)" />
      );
    case "low":
      return (
        <ChevronDown className="h-[12px] w-[12px] text-(--priority-low)" />
      );
    case "no-priority":
      return <Minus className="h-[12px] w-[12px] text-(--priority-none)" />;
    default:
      return <Minus className="h-[12px] w-[12px] text-(--priority-none)" />;
  }
}
