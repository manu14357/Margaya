import { registerTaskPropertySlot } from "@/lib/task-property-slots";
import TaskParentProperty from "./task-parent-property";

// The Parent property of the task sidebar, right after the due date (before
// the planning slots, order 10 and up). Parents are part of every project, so
// no feature gates it.
registerTaskPropertySlot("sidebar", {
  id: "parent",
  order: 0,
  Component: TaskParentProperty,
});
