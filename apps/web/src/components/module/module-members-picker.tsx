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
  resolvePeople,
  StackedAvatars,
  useWorkspacePeople,
} from "./module-people";

type ModuleMembersPickerProps = {
  id?: string;
  workspaceId: string;
  value: readonly string[];
  /** Members who may have left the workspace, to still show them. */
  known?: readonly ModulePerson[];
  onChange: (memberIds: string[]) => void;
  disabled?: boolean;
  /** A custom trigger; defaults to a full-width outline button. */
  children?: ReactElement;
};

/** Picks several workspace members; each toggle calls `onChange`. */
export default function ModuleMembersPicker({
  id,
  workspaceId,
  value,
  known,
  onChange,
  disabled,
  children,
}: ModuleMembersPickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const people = useWorkspacePeople(workspaceId);
  const members = resolvePeople(value, people, known);

  const trigger = children ?? (
    <Button
      id={id}
      type="button"
      variant="outline"
      disabled={disabled}
      className="w-full justify-between font-normal"
    >
      {members.length > 0 ? (
        <StackedAvatars people={members} />
      ) : (
        <span className="text-muted-foreground">
          {t("modules:form.noMembers")}
        </span>
      )}
      <ChevronsUpDown className="size-3.5 text-muted-foreground" />
    </Button>
  );

  if (disabled) return trigger;

  const toggle = (personId: string) =>
    onChange(
      value.includes(personId)
        ? value.filter((memberId) => memberId !== personId)
        : [...value, personId],
    );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <PeopleList
          people={people}
          isSelected={(personId) => value.includes(personId)}
          onSelect={toggle}
        />
      </PopoverContent>
    </Popover>
  );
}
