import { type ComponentProps, lazy, Suspense, useState } from "react";

const CreateIntakeDialog = lazy(() => import("./create-intake-dialog"));

/**
 * "New request" for places mounted on every page (the command palette). The
 * form and its editor load the first time it opens, not with the page; after
 * that it stays mounted, so it opens and closes exactly as the dialog does.
 */
export default function LazyCreateIntakeDialog(
  props: ComponentProps<typeof CreateIntakeDialog>,
) {
  const [opened, setOpened] = useState(props.open);
  if (props.open && !opened) setOpened(true);
  if (!opened) return null;

  return (
    <Suspense fallback={null}>
      <CreateIntakeDialog {...props} />
    </Suspense>
  );
}
