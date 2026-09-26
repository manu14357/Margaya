import { useTranslation } from "react-i18next";
import CommentEditor from "@/components/activity/comment-editor";

type TaskDescriptionEditorProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  taskId?: string;
  ensureTaskId?: () => Promise<string | null>;
  /** False refuses files (a draft has no task to hold them). */
  allowFileUploads?: boolean;
  fileUploadsDisabledMessage?: string;
};

export default function TaskDescriptionEditor({
  value,
  onChange,
  placeholder,
  taskId,
  ensureTaskId,
  allowFileUploads,
  fileUploadsDisabledMessage,
}: TaskDescriptionEditorProps) {
  const { t } = useTranslation();

  return (
    <CommentEditor
      value={value}
      onChange={onChange}
      placeholder={placeholder ?? t("tasks:detail.addDescription")}
      taskId={taskId}
      ensureTaskId={ensureTaskId}
      allowFileUploads={allowFileUploads}
      fileUploadsDisabledMessage={fileUploadsDisabledMessage}
      uploadSurface="description"
      className="[&_.margaya-comment-editor-content_.ProseMirror]:min-h-[11rem] [&_.margaya-comment-editor-content_.ProseMirror]:max-h-none [&_.margaya-comment-editor-content_.ProseMirror]:overflow-visible [&_.margaya-comment-editor-content_.ProseMirror]:px-0 [&_.margaya-comment-editor-content_.ProseMirror]:pt-1 [&_.margaya-comment-editor-content_.ProseMirror]:pb-2"
    />
  );
}
