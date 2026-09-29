import { Check, ChevronsUpDown } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";
import { getInitials } from "@/lib/get-initials";

type CycleOwnerFieldProps = {
  id?: string;
  workspaceId: string;
  value: string | null;
  onChange: (ownerId: string | null) => void;
  disabled?: boolean;
};

function OwnerAvatar({
  name,
  image,
}: {
  name?: string | null;
  image?: string | null;
}) {
  return (
    <Avatar className="size-5">
      <AvatarImage src={image ?? ""} alt={name ?? ""} />
      <AvatarFallback className="border border-border/30 font-medium text-[10px]">
        {getInitials(name)}
      </AvatarFallback>
    </Avatar>
  );
}

/** Picks the cycle's owner among the workspace's members. */
export default function CycleOwnerField({
  id,
  workspaceId,
  value,
  onChange,
  disabled,
}: CycleOwnerFieldProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { data: users } = useGetActiveWorkspaceUsers(workspaceId);
  const members = users?.members ?? [];
  const owner = members.find((member) => member.userId === value);

  const select = (ownerId: string | null) => {
    onChange(ownerId);
    setOpen(false);
  };

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
          <span className="flex min-w-0 items-center gap-2">
            {owner && (
              <OwnerAvatar name={owner.user?.name} image={owner.user?.image} />
            )}
            <span className="truncate">
              {owner?.user?.name ?? t("cycles:row.noOwner")}
            </span>
          </span>
          <ChevronsUpDown className="size-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <div className="max-h-72 space-y-1 overflow-y-auto p-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 w-full justify-start gap-2 px-2"
            onClick={() => select(null)}
          >
            <span className="text-muted-foreground text-sm">
              {t("cycles:row.noOwner")}
            </span>
            {!value && <Check className="ml-auto size-4" />}
          </Button>
          {members.map((member) => (
            <Button
              key={member.userId}
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-full justify-start gap-2 px-2"
              onClick={() => select(member.userId)}
            >
              <OwnerAvatar
                name={member.user?.name}
                image={member.user?.image}
              />
              <span className="truncate text-sm">{member.user?.name}</span>
              {value === member.userId && (
                <Check className="ml-auto size-4 shrink-0" />
              )}
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
