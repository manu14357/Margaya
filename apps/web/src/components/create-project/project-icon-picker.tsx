import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import icons from "@/constants/project-icons";
import { cn } from "@/lib/cn";

/** The project icon button and its searchable grid of icons. */
export function ProjectIconPicker({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (icon: string) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const Selected = icons[value as keyof typeof icons] ?? icons.Layout;
  const filtered = Object.entries(icons).filter(([name]) =>
    name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch("");
      }}
      modal
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className={cn("shrink-0 pointer-coarse:size-11", className)}
          aria-label={t("common:modals.createProject.pickIcon")}
          title={t("common:modals.createProject.pickIcon")}
        >
          <Selected className="size-4" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="start">
        <div className="space-y-2">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("common:modals.createProject.searchIcons")}
            aria-label={t("common:modals.createProject.searchIcons")}
            className="h-8 text-xs"
          />
          <div className="max-h-[280px] overflow-y-auto pe-1">
            <div className="grid grid-cols-6 gap-1.5">
              {filtered.map(([name, Icon]) => (
                <Button
                  key={name}
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-pressed={value === name}
                  onClick={() => {
                    onChange(name);
                    setOpen(false);
                    setSearch("");
                  }}
                  className={cn(
                    "h-10 items-center justify-center rounded-md p-0",
                    value === name &&
                      "bg-sidebar-accent text-sidebar-accent-foreground",
                  )}
                  title={name}
                  aria-label={name}
                >
                  <Icon className="size-4" aria-hidden />
                </Button>
              ))}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
