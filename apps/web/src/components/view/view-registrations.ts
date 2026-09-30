import { Layers } from "lucide-react";
import { registerEntityLink } from "@/lib/entity-links";
import { registerProjectSection } from "@/lib/project-sections";
import { viewEntityLink } from "@/lib/view/entity-link";

// Everything saved views add to shared screens, registered once from
// src/feature-registrations.ts: the project's Views section and how
// favorites and recents open a view.

registerProjectSection({
  id: "views",
  labelKey: "navigation:projectNav.views",
  icon: Layers,
  feature: "views",
  segment: "views",
  shortcutKey: "v",
});

registerEntityLink("view", viewEntityLink);
