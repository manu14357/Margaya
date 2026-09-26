import useCopyTaskDialog from "@/store/copy-task-dialog";
import CopyTaskDialog from "./copy-task-dialog";

/**
 * The one "Make a copy" dialog of the app. Menus only record the task in the
 * store, so the dialog survives the menu that opened it closing.
 */
export default function CopyTaskDialogHost() {
  const target = useCopyTaskDialog((state) => state.target);
  const close = useCopyTaskDialog((state) => state.close);

  if (!target) return null;

  return (
    <CopyTaskDialog
      key={target.taskId}
      target={target}
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    />
  );
}
