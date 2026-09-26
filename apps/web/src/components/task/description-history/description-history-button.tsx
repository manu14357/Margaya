import { History } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import DescriptionHistoryDialog from "./description-history-dialog";

/** "History" in the description area: opens the saved versions. */
export default function DescriptionHistoryButton({
  taskId,
  projectId,
  className,
}: {
  taskId: string;
  projectId: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        size="xs"
        className={cn("text-muted-foreground", className)}
        onClick={() => setOpen(true)}
      >
        <History className="size-3.5" />
        {t("tasks:descriptionHistory.open")}
      </Button>
      {open && (
        <DescriptionHistoryDialog
          taskId={taskId}
          projectId={projectId}
          open={open}
          onOpenChange={setOpen}
        />
      )}
    </>
  );
}
