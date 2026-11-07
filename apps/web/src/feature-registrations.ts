// Feature slices register their project sections (lib/project-sections),
// task property slots (lib/task-property-slots) and entity links
// (lib/entity-links) from their own modules. Import each such module here,
// for its side effect, so the registrations exist before the first render:
//
//   import "@/components/cycle/cycle-registrations";
import "@/components/module/module-registrations";
//
// main.tsx imports this file once.
import "@/components/analytics/analytics-registrations";
import "@/components/cycle/cycle-registrations";
import "@/components/estimate/estimate-registrations";
import "@/components/intake/intake-registrations";
import "@/components/page/page-registrations";
import "@/components/project/custom-field-registrations";
import "@/components/task/register-task-parent-slot";
import "@/components/time-entry/time-entry-registrations";
import "@/components/view/view-registrations";
