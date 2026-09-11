import { assigneeKey } from "./assignee";
import { createdByKey } from "./created-by";
import { customFieldKey } from "./custom-field";
import { cycleKey } from "./cycle";
import { dateKeys } from "./dates";
import { estimateKey } from "./estimate";
import { groupKey } from "./group";
import { labelKey } from "./label";
import { moduleKey } from "./module";
import { parentKey } from "./parent";
import { priorityKey } from "./priority";
import { projectKey } from "./project";
import { filterKeyRegistry } from "./registry";
import { statusKey } from "./status";

// The built-in keys (B4 §2.3). `subscriber` and `mention` stay unsupported
// until B10 registers them with registerFilterKey.
for (const descriptor of [
  statusKey,
  groupKey,
  priorityKey,
  assigneeKey,
  createdByKey,
  labelKey,
  cycleKey,
  moduleKey,
  estimateKey,
  projectKey,
  parentKey,
  customFieldKey,
  ...dateKeys,
]) {
  if (!filterKeyRegistry.has(descriptor.key)) {
    filterKeyRegistry.register(descriptor);
  }
}

export {
  type DateFilterKey,
  type FilterKeyDescriptor,
  FilterKeyRegistry,
  filterKeyRegistry,
  isFilterKeyRegistered,
  RESERVED_FILTER_KEYS,
  registerFilterKey,
  type SetFilterKey,
} from "./registry";
