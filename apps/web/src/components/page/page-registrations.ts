import { FileText } from "lucide-react";
import { registerEntityLink } from "@/lib/entity-links";
import { pageEntityLink } from "@/lib/pages/page-paths";
import { registerProjectSection } from "@/lib/project-sections";

// Everything the pages slice adds to shared screens, registered once from
// src/feature-registrations.ts. The section is hidden while the project's
// pages feature is off.

registerProjectSection({
  id: "pages",
  labelKey: "navigation:projectNav.pages",
  icon: FileText,
  feature: "pages",
  segment: "pages",
  shortcutKey: "p",
});

registerEntityLink("page", pageEntityLink);
