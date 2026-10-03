import { ChevronDown, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/cn";
import MemberAvatar from "./member-avatar";
import type { PageMember } from "./use-page-members";

type PageOwnerFilterProps = {
  /** People who own at least one page of the project. */
  owners: PageMember[];
  selected: readonly string[];
  onChange: (ownerIds: string[]) => void;
};

/** "Owner": pick any number of people (a page matches any of them). */
export default function PageOwnerFilter({
  owners,
  selected,
  onChange,
}: PageOwnerFilterProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return owners.filter((owner) => owner.name.toLowerCase().includes(needle));
  }, [owners, query]);

  const toggle = (ownerId: string) =>
    onChange(
      selected.includes(ownerId)
        ? selected.filter((id) => id !== ownerId)
        : [...selected, ownerId],
    );

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="xs"
            className={cn(
              "gap-1",
              selected.length > 0 && "border-primary/40 text-foreground",
            )}
          />
        }
      >
        {t("pages:list.ownerFilter")}
        {selected.length > 0 && (
          <span className="rounded-sm bg-primary/10 px-1 text-[10px] text-primary">
            {selected.length}
          </span>
        )}
        <ChevronDown className="size-3 opacity-70" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1">
        <div className="relative p-1">
          <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-3.5 z-10 size-3.5 text-muted-foreground" />
          <Input
            size="sm"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("pages:list.ownerFilterSearch")}
            aria-label={t("pages:list.ownerFilterSearch")}
            className="[&_[data-slot=input]]:pl-8"
          />
        </div>
        <div className="max-h-64 overflow-y-auto">
          {visible.map((owner) => {
            const checked = selected.includes(owner.id);
            return (
              // biome-ignore lint/a11y/noLabelWithoutControl: the checkbox inside is the control
              <label
                key={owner.id}
                className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={() => toggle(owner.id)}
                />
                <MemberAvatar name={owner.name} image={owner.image} />
                <span className="truncate">{owner.name}</span>
              </label>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
