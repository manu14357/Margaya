import { ChevronsUpDown } from "lucide-react";
import { type ReactElement, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  type ModulePerson,
  PeopleList,
  PersonAvatar,
  resolvePeople,
  useWorkspacePeople,
} from "./module-people";

type ModuleLeadPickerProps = {
  id?: string;
  workspaceId: string;
  value: string | null;
  /** The current lead when they are no longer a workspace member. */
  fallback?: ModulePerson | null;
  onChange: (leadId: string | null) => void;
  disabled?: boolean;
  /** A custom trigger; defaults to a full-width outline button. */
  children?: ReactElement;
};

/** Picks the module's lead: one workspace member, or nobody. */
export default function ModuleLeadPicker({
  id,
  workspaceId,
  value,
  fallback,
  onChange,
  disabled,
  children,
}: ModuleLeadPickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const people = useWorkspacePeople(workspaceId);
  const [lead] = resolvePeople(value ? [value] : [], people, [
    ...(fallback ? [fallback] : []),
  ]);

  const trigger = children ?? (
    <Button
      id={id}
      type="button"
      variant="outline"
      disabled={disabled}
      className="w-full justify-between font-normal"
    >
      <span className="flex min-w-0 items-center gap-2">
        {lead && <PersonAvatar person={lead} />}
        <span className={lead ? "truncate" : "truncate text-muted-foreground"}>
          {lead?.name ?? t("modules:row.noLead")}
        </span>
      </span>
      <ChevronsUpDown className="size-3.5 text-muted-foreground" />
    </Button>
  );

  if (disabled) return trigger;

  const select = (leadId: string | null) => {
    setOpen(false);
    if (leadId !== value) onChange(leadId);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <PeopleList
          people={people}
          isSelected={(personId) => personId === value}
          onSelect={select}
          none={{
            label: t("modules:row.noLead"),
            selected: !value,
            onSelect: () => select(null),
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
