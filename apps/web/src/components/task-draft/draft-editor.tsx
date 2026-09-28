import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import CreateTaskModal from "@/components/shared/modals/create-task-modal";
import { useTaskDraft } from "@/hooks/queries/task-draft/use-task-draft";
import { toast } from "@/lib/toast";

type DraftEditorProps = {
  workspaceId: string;
  /** The draft to edit; null closes the editor. */
  draftId: string | null;
  onClose: () => void;
};

/**
 * The draft editor: the create-task dialog in edit mode, opened once the
 * draft (with its description) has loaded.
 */
export default function DraftEditor({
  workspaceId,
  draftId,
  onClose,
}: DraftEditorProps) {
  const { t } = useTranslation();
  const { data: draft, isError } = useTaskDraft(workspaceId, draftId);

  // Gone (deleted or published elsewhere) or unreadable: say so and close.
  useEffect(() => {
    if (!draftId || !isError) return;
    toast.error(t("tasks:drafts.loadError"));
    onClose();
  }, [draftId, isError, onClose, t]);

  if (!draftId || !draft || draft.id !== draftId) return null;

  return <CreateTaskModal open draft={draft} onClose={onClose} />;
}
