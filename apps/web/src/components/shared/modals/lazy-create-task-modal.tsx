import { type ComponentProps, lazy, Suspense, useState } from "react";

const CreateTaskModal = lazy(() => import("./create-task-modal"));

/**
 * The create-task modal for places mounted on every page (the command
 * palette, Ask). The form and its editor load the first time it opens, not
 * with the page; after that it stays mounted, so it opens and closes exactly
 * as the modal itself does.
 */
export default function LazyCreateTaskModal(
  props: ComponentProps<typeof CreateTaskModal>,
) {
  const [opened, setOpened] = useState(props.open);
  if (props.open && !opened) setOpened(true);
  if (!opened) return null;

  return (
    <Suspense fallback={null}>
      <CreateTaskModal {...props} />
    </Suspense>
  );
}
