import { Check, ChevronsUpDown } from "lucide-react";
import { type ReactElement, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ShortcutNumber } from "@/components/ui/shortcut-number";
import { useUpdateModule } from "@/hooks/mutations/module/use-update-module";
import { useNumberedShortcuts } from "@/hooks/use-numbered-shortcuts";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { MODULE_STATUS_META, MODULE_STATUS_ORDER } from "@/lib/module/status";
import { toast } from "@/lib/toast";
import type { Module, ModuleStatus } from "@/types/module";
import { ModuleStatusLabel } from "./module-status";

type ModuleStatusOptionsProps = {
  value: ModuleStatus;
  onSelect: (status: ModuleStatus) => void;
  /** Number keys 1–6 pick a status while the list is open. */
  shortcutsEnabled: boolean;
};

/** The six statuses with a check on the current one. */
function ModuleStatusOptions({
  value,
  onSelect,
  shortcutsEnabled,
}: ModuleStatusOptionsProps) {
  const { t } = useTranslation();
  const shortcutOptions = useMemo(
    () =>
      MODULE_STATUS_ORDER.map((status) => ({
        onSelect: () => onSelect(status),
      })),
    [onSelect],
  );
  useNumberedShortcuts(shortcutsEnabled, shortcutOptions);

  return (
    <div>
      {MODULE_STATUS_ORDER.map((status, index) => {
        const meta = MODULE_STATUS_META[status];
        const Icon = meta.icon;
        return (
          <Button
            key={status}
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 w-full justify-start gap-2 rounded-none px-2 first:rounded-t-md last:rounded-b-md"
            onClick={() => onSelect(status)}
          >
            <Icon className={`size-4 ${meta.iconClassName}`} />
            <span className="text-sm">{t(meta.labelKey)}</span>
            {value === status ? (
              <Check className="ml-auto size-4" />
            ) : (
              <ShortcutNumber number={index + 1} />
            )}
          </Button>
        );
      })}
    </div>
  );
}

type ModuleStatusPopoverProps = {
  module: Pick<Module, "id" | "projectId" | "status" | "archivedAt">;
  children: ReactElement;
};

/**
 * Changes a module's status in place. Read-only (just the trigger) for
 * archived modules and for users who can't update modules.
 */
export function ModuleStatusPopover({
  module,
  children,
}: ModuleStatusPopoverProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { mutate: updateModule } = useUpdateModule();
  const { canUpdateModules, isCheckingPermissions } = useWorkspacePermission();

  if (isCheckingPermissions || !canUpdateModules() || module.archivedAt) {
    return children;
  }

  const handleSelect = (status: ModuleStatus) => {
    setOpen(false);
    if (status === module.status) return;
    updateModule(
      { moduleId: module.id, projectId: module.projectId, json: { status } },
      {
        onError: (error) =>
          toast.error(error.message || t("modules:toast.saveError")),
      },
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-52 p-0" align="start">
        <ModuleStatusOptions
          value={module.status}
          onSelect={handleSelect}
          shortcutsEnabled={open}
        />
      </PopoverContent>
    </Popover>
  );
}

type ModuleStatusFieldProps = {
  id?: string;
  value: ModuleStatus;
  onChange: (status: ModuleStatus) => void;
  disabled?: boolean;
};

/** The form's status picker. */
export function ModuleStatusField({
  id,
  value,
  onChange,
  disabled,
}: ModuleStatusFieldProps) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <ModuleStatusLabel status={value} />
          <ChevronsUpDown className="size-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-52 p-0" align="start">
        <ModuleStatusOptions
          value={value}
          onSelect={(status) => {
            onChange(status);
            setOpen(false);
          }}
          shortcutsEnabled={open}
        />
      </PopoverContent>
    </Popover>
  );
}
