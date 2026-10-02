import { Inbox } from "lucide-react";
import { registerProjectSection } from "@/lib/project-sections";
import { useIntakeSectionBadge } from "./use-intake-section-badge";

// Everything intake adds to shared screens, registered once from
// src/feature-registrations.ts: the project's Intake section with its
// pending-count badge. The section shows only while intake is on.

registerProjectSection({
  id: "intake",
  labelKey: "navigation:projectNav.intake",
  icon: Inbox,
  feature: "intake",
  segment: "intake",
  shortcutKey: "i",
  useBadge: useIntakeSectionBadge,
  badgeAriaKey: "intake:badge.aria",
});
