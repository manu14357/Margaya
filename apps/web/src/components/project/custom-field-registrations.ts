import CustomFieldBulkAction from "@/components/bulk-selection/custom-field-bulk-action";
import { registerTaskPropertySlot } from "@/lib/task-property-slots";

registerTaskPropertySlot("bulkAction", {
  id: "custom-field",
  order: 90,
  Component: CustomFieldBulkAction,
});
