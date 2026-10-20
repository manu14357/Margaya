import { Search } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Command,
  CommandCollection,
  CommandDialog,
  CommandDialogPopup,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  CommandSeparator,
} from "@/components/ui/command";
import { getColumnIcon } from "@/lib/column";

// Items stay plain data (the list may serialize them); the status icon is
// drawn from these fields.
export type PickerTask = {
  id: string;
  /** The task key, e.g. WEB-12. */
  key: string;
  title: string;
  projectId: string;
  /** Shown as a tooltip on the key for tasks of other projects. */
  projectName?: string;
  status: string;
  /** The status column's look, when known. */
  column?: {
    icon?: string | null;
    isFinal?: boolean | null;
    group?: string | null;
  };
  /** What the command list filters and announces. */
  label: string;
  /** A short muted note after the title, e.g. why AI suggests it. */
  hint?: string;
};

export type PickerGroup = {
  value: string;
  label: string;
  items: PickerTask[];
};

type TaskPickerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onQueryChange: (query: string) => void;
  placeholder: string;
  /** Already filtered by the query; empty groups are left out. */
  groups: PickerGroup[];
  onPick: (task: PickerTask) => void;
  /** Muted lines under the list, such as a search in progress. */
  status?: ReactNode;
  footer?: ReactNode;
};

/** A command dialog listing tasks by group, like the relation picker. */
export default function TaskPickerDialog({
  open,
  onOpenChange,
  query,
  onQueryChange,
  placeholder,
  groups,
  onPick,
  status,
  footer,
}: TaskPickerDialogProps) {
  const { t } = useTranslation();
  const visibleGroups = groups.filter((group) => group.items.length > 0);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandDialogPopup>
        <Command
          items={visibleGroups}
          filter={null}
          itemToStringValue={(item) => (item as PickerTask).label}
        >
          <CommandInput
            placeholder={placeholder}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
          />
          <CommandPanel>
            {!status && (
              <CommandEmpty>
                <div className="py-6 text-center">
                  <Search className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                  <p className="text-muted-foreground text-sm">
                    {t("tasks:relations.noTasksFound")}
                  </p>
                </div>
              </CommandEmpty>
            )}
            <CommandList>
              {(group: PickerGroup, groupIndex: number) => (
                <Fragment key={group.value}>
                  <CommandGroup items={group.items}>
                    <CommandGroupLabel>{group.label}</CommandGroupLabel>
                    <CommandCollection>
                      {(item: PickerTask) => (
                        <CommandItem
                          key={`${group.value}-${item.id}`}
                          value={item}
                          onClick={() => onPick(item)}
                          className="flex items-center gap-3 py-2"
                        >
                          {getColumnIcon(
                            item.status,
                            item.column?.isFinal ?? false,
                            item.column?.icon,
                            item.column?.group,
                          )}
                          <span
                            className="shrink-0 font-mono text-muted-foreground text-xs"
                            title={item.projectName}
                          >
                            {item.key}
                          </span>
                          <span className="flex-1 truncate text-sm">
                            {item.title}
                          </span>
                          {item.hint && (
                            <span className="hidden max-w-[45%] shrink-0 truncate text-muted-foreground text-xs sm:inline">
                              {item.hint}
                            </span>
                          )}
                        </CommandItem>
                      )}
                    </CommandCollection>
                  </CommandGroup>
                  {groupIndex < visibleGroups.length - 1 && (
                    <CommandSeparator />
                  )}
                </Fragment>
              )}
            </CommandList>
            {status && (
              <div className="px-4 pb-3 text-muted-foreground text-xs">
                {status}
              </div>
            )}
          </CommandPanel>
          {footer && <CommandFooter>{footer}</CommandFooter>}
        </Command>
      </CommandDialogPopup>
    </CommandDialog>
  );
}
