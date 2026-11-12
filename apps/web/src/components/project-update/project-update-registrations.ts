import { Megaphone } from "lucide-react";
import { registerProjectSection } from "@/lib/project-sections";

// The project's Updates section (status updates), registered once from
// src/feature-registrations.ts. Hidden while the project's updates feature
// is off, which it is until someone turns it on.

registerProjectSection({
  id: "updates",
  labelKey: "navigation:projectNav.updates",
  icon: Megaphone,
  feature: "updates",
  segment: "updates",
});
