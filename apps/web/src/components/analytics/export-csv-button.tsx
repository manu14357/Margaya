import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { toCsv } from "@/lib/analytics/csv";
import { csvFileName, downloadCsv } from "@/lib/analytics/export";
import { localToday } from "@/lib/analytics/periods";
import type { TableModel } from "@/lib/analytics/table-model";
import { toast } from "@/lib/toast";
import { useAnalyticsScope } from "./analytics-context";

type ExportCsvButtonProps = {
  /** The table exactly as displayed (sorted, labels translated). */
  model: TableModel | null;
  /** The file name's section, e.g. `breakdown-assignee` or `trend`. */
  section: string;
};

/** Downloads the table as CSV in the browser; disabled while it is empty. */
export default function ExportCsvButton({
  model,
  section,
}: ExportCsvButtonProps) {
  const { t } = useTranslation();
  const { slug } = useAnalyticsScope();
  const count = model?.rows.length ?? 0;

  const handleExport = () => {
    if (!model || count === 0) return;
    try {
      downloadCsv(csvFileName(slug, section, localToday()), toCsv(model));
      toast.success(t("analytics:export.success", { count }));
    } catch {
      toast.error(t("analytics:export.error"));
    }
  };

  return (
    <Button
      variant="outline"
      size="xs"
      disabled={count === 0}
      onClick={handleExport}
      className="gap-1"
    >
      <Download className="size-3.5" />
      {t("analytics:export.button")}
    </Button>
  );
}
