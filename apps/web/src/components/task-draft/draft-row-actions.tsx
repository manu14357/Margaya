import { MoreHorizontal, Pencil, Send, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import { cn } from "@/lib/cn";

type DraftRowActionsProps = {
  canEdit: boolean;
  onEdit: () => void;
  onPublish: () => void;
  onDelete: () => void;
  className?: string;
};

/** The "⋯" menu of a draft row: Edit, Publish and Delete. */
export default function DraftRowActions({
  canEdit,
  onEdit,
  onPublish,
  onDelete,
  className,
}: DraftRowActionsProps) {
  const { t } = useTranslation();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t("tasks:drafts.actions.menuAria")}
            className={cn(className)}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          />
        }
      >
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-44"
        onClick={(event) => event.stopPropagation()}
      >
        {canEdit && (
          <>
            <DropdownMenuItem onClick={onEdit}>
              <Pencil />
              {t("tasks:drafts.actions.edit")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onPublish}>
              <Send />
              {t("tasks:drafts.actions.publish")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem className="text-destructive" onClick={onDelete}>
          <Trash2 />
          {t("tasks:drafts.actions.delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
