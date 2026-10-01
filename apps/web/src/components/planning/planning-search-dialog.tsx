import { Search } from "lucide-react";
import type { ReactNode } from "react";
import {
  CommandDialog,
  CommandDialogPopup,
  CommandFooter,
  CommandPanel,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";

type PlanningSearchDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  query: string;
  onQueryChange: (query: string) => void;
  placeholder: string;
  children: ReactNode;
  footer?: ReactNode;
};

/**
 * The command-dialog frame with a plain search field and list, for pickers
 * that keep their own selection (multi-select, one-click actions).
 */
export default function PlanningSearchDialog({
  open,
  onOpenChange,
  title,
  description,
  query,
  onQueryChange,
  placeholder,
  children,
  footer,
}: PlanningSearchDialogProps) {
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandDialogPopup aria-label={title}>
        <div className="px-5 pt-4 pb-1">
          <h2 className="font-heading font-semibold text-base">{title}</h2>
          {description && (
            <p className="mt-1 text-muted-foreground text-sm">{description}</p>
          )}
        </div>
        <div className="flex items-center gap-2 px-4 py-2">
          <Search className="size-4 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={placeholder}
            aria-label={placeholder}
            className="border-transparent! bg-transparent! shadow-none before:hidden"
          />
        </div>
        <CommandPanel>
          <div className="max-h-80 overflow-y-auto p-2">{children}</div>
        </CommandPanel>
        {footer && <CommandFooter>{footer}</CommandFooter>}
      </CommandDialogPopup>
    </CommandDialog>
  );
}
