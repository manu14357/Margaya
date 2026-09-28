import type { ImportField } from "@/lib/task-import/csv-mapping";

export const FIELD_LABEL_KEYS = {
  title: "settings:tasksImportExport.csv.fields.title",
  description: "settings:tasksImportExport.csv.fields.description",
  status: "settings:tasksImportExport.csv.fields.status",
  priority: "settings:tasksImportExport.csv.fields.priority",
  assignees: "settings:tasksImportExport.csv.fields.assignees",
  labels: "settings:tasksImportExport.csv.fields.labels",
  startDate: "settings:tasksImportExport.csv.fields.startDate",
  dueDate: "settings:tasksImportExport.csv.fields.dueDate",
  estimate: "settings:tasksImportExport.csv.fields.estimate",
  cycle: "settings:tasksImportExport.csv.fields.cycle",
  modules: "settings:tasksImportExport.csv.fields.modules",
} as const satisfies Record<ImportField, string>;
