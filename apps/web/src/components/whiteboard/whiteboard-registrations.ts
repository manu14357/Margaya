import { PenTool } from "lucide-react";
import { registerProjectSection } from "@/lib/project-sections";

// The project's Whiteboards section, registered once from
// src/feature-registrations.ts. Hidden while the project's whiteboards
// feature is off.

registerProjectSection({
  id: "whiteboards",
  labelKey: "navigation:projectNav.whiteboards",
  icon: PenTool,
  feature: "whiteboards",
  segment: "whiteboards",
  shortcutKey: "w",
});
