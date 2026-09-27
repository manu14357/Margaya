import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { useGetColumns } from "@/hooks/queries/column/use-get-columns";
import { getColumnIcon } from "@/lib/column";
import { getStatusDisplayLabel } from "@/lib/i18n/domain";

type TaskStatusChipProps = {
  status: string | null | undefined;
  projectId: string;
};

/**
 * The task's status as a read-only chip for headers. It is changed from the
 * Status property, so this is not a second control with the same name.
 */
export default function TaskStatusChip({
  status,
  projectId,
}: TaskStatusChipProps) {
  const { t } = useTranslation();
  const { data: columns = [] } = useGetColumns(projectId);
  if (!status) return null;
  const column = columns.find(
    (candidate) => candidate.slug === status || candidate.id === status,
  );
  const label = getStatusDisplayLabel(status, column?.name);

  return (
    <Badge
      variant="outline"
      className="hidden max-w-40 shrink-0 gap-1 rounded-full px-2 sm:inline-flex"
      title={t("tasks:status.label")}
    >
      <span aria-hidden className="flex shrink-0 [&_svg]:size-3">
        {getColumnIcon(
          status,
          column?.isFinal ?? false,
          column?.icon,
          column?.group,
        )}
      </span>
      <span className="truncate">{label}</span>
    </Badge>
  );
}
