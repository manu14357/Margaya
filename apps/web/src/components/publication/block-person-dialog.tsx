import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { usePublicCommentModeration } from "@/hooks/mutations/publication/use-public-comment-moderation";
import { toast } from "@/lib/toast";

export type BlockTarget = { userId: string; name: string };

type BlockPersonDialogProps = {
  projectId: string;
  target: BlockTarget | null;
  onOpenChange: (open: boolean) => void;
};

/** "Block {name} from this board?", optionally hiding their comments. */
export default function BlockPersonDialog({
  projectId,
  target,
  onOpenChange,
}: BlockPersonDialogProps) {
  const { t } = useTranslation();
  const { block } = usePublicCommentModeration(projectId);
  const [hideComments, setHideComments] = useState(false);
  const checkboxId = useId();

  useEffect(() => {
    if (target) setHideComments(false);
  }, [target]);

  const confirm = () => {
    if (!target) return;
    block.mutate(
      { userId: target.userId, hideComments },
      {
        onSuccess: () => {
          toast.success(
            t("settings:projectPublish.moderation.blocked", {
              name: target.name,
            }),
          );
          onOpenChange(false);
        },
        onError: (error) =>
          toast.error(
            error.message ||
              t("settings:projectPublish.moderation.actionError"),
          ),
      },
    );
  };

  return (
    <AlertDialog open={target !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("settings:projectPublish.moderation.blockTitle", {
              name: target?.name ?? "",
            })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("settings:projectPublish.moderation.blockDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <label
          htmlFor={checkboxId}
          className="flex items-center gap-2 px-6 text-sm"
        >
          <Checkbox
            id={checkboxId}
            checked={hideComments}
            onCheckedChange={(value) => setHideComments(Boolean(value))}
          />
          {t("settings:projectPublish.moderation.blockHideComments")}
        </label>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" size="sm" />}>
            {t("common:actions.cancel")}
          </AlertDialogClose>
          <Button
            variant="destructive"
            size="sm"
            onClick={confirm}
            disabled={block.isPending}
          >
            {t("settings:projectPublish.moderation.blockConfirm")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
