import { ChevronsUpDown } from "lucide-react";
import { useState } from "react";
import {
  PeopleList,
  PersonAvatar,
  resolvePeople,
  useWorkspacePeople,
} from "@/components/module/module-people";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

type ProjectMemberPickerProps = {
  id?: string;
  workspaceId: string;
  value: string | null;
  onChange: (userId: string | null) => void;
  /** Accessible name of the trigger. */
  label: string;
  /** The "nobody" row and the empty trigger text. */
  noneLabel: string;
  disabled?: boolean;
};

/** Picks one workspace member, or nobody (project lead, default assignee). */
export default function ProjectMemberPicker({
  id,
  workspaceId,
  value,
  onChange,
  label,
  noneLabel,
  disabled,
}: ProjectMemberPickerProps) {
  const [open, setOpen] = useState(false);
  const people = useWorkspacePeople(workspaceId);
  const [person] = resolvePeople(value ? [value] : [], people);

  const select = (userId: string | null) => {
    setOpen(false);
    if (userId !== value) onChange(userId);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          aria-label={`${label}: ${person?.name ?? noneLabel}`}
          className="w-full justify-between font-normal sm:w-64"
        >
          <span className="flex min-w-0 items-center gap-2">
            {person && <PersonAvatar person={person} />}
            <span
              className={person ? "truncate" : "truncate text-muted-foreground"}
            >
              {person?.name ?? noneLabel}
            </span>
          </span>
          <ChevronsUpDown className="size-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="end">
        <PeopleList
          people={people}
          isSelected={(userId) => userId === value}
          onSelect={select}
          none={{
            label: noneLabel,
            selected: !value,
            onSelect: () => select(null),
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
