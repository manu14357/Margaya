import { ChevronLeft, SquarePen } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import CustomFieldValuePicker from "@/components/project/custom-field-value-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import useBulkSetCustomFieldValue from "@/hooks/mutations/custom-field/use-bulk-set-custom-field-value";
import useGetCustomFieldsByProject from "@/hooks/queries/custom-field/use-get-custom-fields-by-project";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import type { TaskPropertySlotProps } from "@/lib/task-property-slots";
import { toast } from "@/lib/toast";

type Field = {
  id: string;
  name: string;
  type: string;
  required: boolean;
  options: unknown;
};

/**
 * "Custom field" in the bulk toolbars: pick a field, then the value every
 * selected task gets. The route checks the tasks are in the field's project.
 */
export default function CustomFieldBulkAction({
  taskIds,
  onDone,
  projectId,
}: TaskPropertySlotProps["bulkAction"]) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [field, setField] = useState<Field | null>(null);
  const [typed, setTyped] = useState("");
  const { canUpdateTasks, isCheckingPermissions } = useWorkspacePermission();
  const { data: fields } = useGetCustomFieldsByProject(projectId);
  const bulkSet = useBulkSetCustomFieldValue(projectId);

  const list = (fields ?? []) as Field[];
  if (isCheckingPermissions || !canUpdateTasks() || list.length === 0) {
    return null;
  }

  const reset = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setField(null);
      setTyped("");
    }
  };

  const apply = async (selected: Field, value: string) => {
    reset(false);
    try {
      const result = await bulkSet.mutateAsync({
        taskIds,
        fieldId: selected.id,
        value,
      });
      toast.success(
        t("tasks:customFieldBulk.updated", { count: result.updatedCount }),
      );
      onDone();
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t("tasks:customFieldBulk.error"),
      );
    }
  };

  const isTyped = field?.type === "text" || field?.type === "number";

  return (
    <Popover open={open} onOpenChange={reset}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" disabled={bulkSet.isPending}>
          <SquarePen className="size-4" />
          {t("tasks:customFieldBulk.action")}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="center"
        className={field?.type === "date" ? "w-auto p-0" : "w-56 p-0"}
      >
        {!field ? (
          <div className="max-h-64 overflow-y-auto py-1">
            <p className="px-3 py-1.5 text-muted-foreground text-xs">
              {t("tasks:customFieldBulk.chooseField")}
            </p>
            {list.map((candidate) => (
              <Button
                key={candidate.id}
                variant="ghost"
                size="sm"
                className="w-full justify-start rounded-none font-normal"
                onClick={() => setField(candidate)}
              >
                <span className="truncate">{candidate.name}</span>
              </Button>
            ))}
          </div>
        ) : (
          <div>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-1 rounded-none border-border border-b font-medium"
              onClick={() => setField(null)}
            >
              <ChevronLeft className="size-4" />
              <span className="truncate">{field.name}</span>
            </Button>
            {isTyped ? (
              <form
                className="grid gap-2 p-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void apply(field, typed);
                }}
              >
                <Input
                  autoFocus
                  value={typed}
                  type={field.type === "number" ? "number" : "text"}
                  placeholder={t("tasks:customFieldValue.placeholder")}
                  aria-label={t("tasks:customFieldValue.placeholder")}
                  onChange={(event) => setTyped(event.target.value)}
                />
                <Button
                  type="submit"
                  size="sm"
                  disabled={field.required && !typed.trim()}
                >
                  {t("tasks:customFieldBulk.apply")}
                </Button>
              </form>
            ) : (
              <CustomFieldValuePicker
                field={field}
                value=""
                onSelect={(value) => void apply(field, value)}
              />
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
