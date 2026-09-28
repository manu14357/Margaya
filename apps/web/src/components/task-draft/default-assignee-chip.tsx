import { AtSign, X } from "lucide-react";
import { useTranslation } from "react-i18next";

/** The project's default assignee in the capture preview; removable. */
export default function DefaultAssigneeChip({
  name,
  onRemove,
}: {
  name: string;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  return (
    <span
      data-token="default-assignee"
      className="inline-flex h-5 max-w-48 items-center gap-1 rounded-full border border-border border-dashed bg-background ps-1.5 pe-0.5 text-foreground text-xs"
      title={t("tasks:capture.defaultAssignee", { name })}
    >
      <AtSign className="size-3 text-muted-foreground" />
      <span className="truncate">{name}</span>
      <button
        type="button"
        className="flex size-4 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label={t("tasks:capture.removeDefaultAssignee", { name })}
        // Keeps focus in the input.
        onMouseDown={(event) => event.preventDefault()}
        onClick={onRemove}
      >
        <X className="size-3" />
      </button>
    </span>
  );
}
