import type { IntakeItem } from "@/types/intake";
import AcceptIntakeDialog from "./accept-intake-dialog";
import CreateIntakeDialog from "./create-intake-dialog";
import DeclineIntakeDialog from "./decline-intake-dialog";
import DeleteIntakeDialog from "./delete-intake-dialog";
import DuplicateIntakeDialog from "./duplicate-intake-dialog";
import { SnoozeIntakeDialog } from "./snooze-intake-popover";

export type IntakeDialog =
  | "accept"
  | "decline"
  | "duplicate"
  | "snoozeAgain"
  | "edit"
  | "delete"
  | "withdraw";

type IntakeDetailDialogsProps = {
  dialog: IntakeDialog | null;
  onClose: () => void;
  item: IntakeItem;
  workspaceId: string;
  /** The task's description, for the requester's edit. */
  description: string;
  onChanged: (item: IntakeItem) => void;
  onDeleted: (item: IntakeItem) => void;
};

/** The request detail's dialogs; one is open at a time. */
export default function IntakeDetailDialogs({
  dialog,
  onClose,
  item,
  workspaceId,
  description,
  onChanged,
  onDeleted,
}: IntakeDetailDialogsProps) {
  const openChange = (open: boolean) => {
    if (!open) onClose();
  };

  return (
    <>
      <AcceptIntakeDialog
        open={dialog === "accept"}
        onOpenChange={openChange}
        item={item}
        workspaceId={workspaceId}
        onAccepted={onChanged}
      />
      <DeclineIntakeDialog
        open={dialog === "decline"}
        onOpenChange={openChange}
        item={item}
        onDeclined={onChanged}
      />
      <DuplicateIntakeDialog
        open={dialog === "duplicate"}
        onOpenChange={openChange}
        item={item}
        onMarked={onChanged}
      />
      <SnoozeIntakeDialog
        open={dialog === "snoozeAgain"}
        onOpenChange={openChange}
        item={item}
        onSnoozed={onChanged}
      />
      <CreateIntakeDialog
        open={dialog === "edit"}
        onOpenChange={openChange}
        projectId={item.projectId}
        intakeItem={item}
        description={description}
      />
      <DeleteIntakeDialog
        open={dialog === "delete" || dialog === "withdraw"}
        onOpenChange={openChange}
        item={item}
        withdraw={dialog === "withdraw"}
        onDeleted={onDeleted}
      />
    </>
  );
}
