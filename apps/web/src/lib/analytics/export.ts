import { saveAs } from "file-saver";

// Browser-side CSV download (K12): no export route, the table on screen is
// the file.

/** `{slug}-analytics-{section}-{YYYY-MM-DD}.csv` */
export function csvFileName(slug: string, section: string, today: string) {
  const safe = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "workspace";
  return `${safe(slug)}-analytics-${safe(section)}-${today}.csv`;
}

export function downloadCsv(fileName: string, text: string) {
  saveAs(new Blob([text], { type: "text/csv;charset=utf-8" }), fileName);
}
