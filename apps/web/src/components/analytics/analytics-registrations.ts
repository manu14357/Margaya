import { ChartColumn } from "lucide-react";
import { registerProjectSection } from "@/lib/project-sections";

// The project's Analytics section: at the right end of the section strip,
// for people with the analytics permission, whatever the project's features.

registerProjectSection({
  id: "analytics",
  labelKey: "navigation:projectNav.analytics",
  icon: ChartColumn,
  feature: null,
  requires: "readAnalytics",
  align: "end",
  segment: "analytics",
});
