import { registerTaskPropertySlot } from "@/lib/task-property-slots";
import TaskTimeTracking from "./task-time-tracking";

// The time-tracking slice's additions to shared screens, registered once from
// src/feature-registrations.ts. Hidden while the project's time tracking is
// off.

registerTaskPropertySlot("sidebar", {
  id: "timeTracking",
  feature: "timeTracking",
  // After the cycle (10), module (20) and estimate (30) slots.
  order: 40,
  Component: TaskTimeTracking,
});
