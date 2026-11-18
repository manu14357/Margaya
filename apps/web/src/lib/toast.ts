import { toastManager } from "@/components/ui/toast";

type ToastVariant = "success" | "error" | "info" | "warning";

type ToastAction = {
  label: string;
  onClick?: () => void;
};

type ToastOptions = {
  description?: string;
  action?: ToastAction;
  cancel?: ToastAction;
  /** Stays until dismissed: for something the user still has to act on. */
  persistent?: boolean;
};

function addToast(
  title: string,
  variant?: ToastVariant,
  options?: ToastOptions,
) {
  let id = "";

  const action = options?.action ?? options?.cancel;

  id = toastManager.add({
    title,
    description: options?.description,
    type: variant,
    ...(options?.persistent ? { timeout: 0 } : {}),
    actionProps: action
      ? {
          children: action.label,
          onClick: () => {
            action.onClick?.();
            toastManager.close(id);
          },
        }
      : undefined,
  });

  return id;
}

type ToastFn = (title: string, options?: ToastOptions) => string;
type ToastId = string;

const success: ToastFn = (title, options) =>
  addToast(title, "success", options);
const error: ToastFn = (title, options) => addToast(title, "error", options);
const info: ToastFn = (title, options) => addToast(title, "info", options);
const warning: ToastFn = (title, options) =>
  addToast(title, "warning", options);
const message: ToastFn = (title, options) =>
  addToast(title, undefined, options);
const loading: ToastFn = (title, options) => {
  let id = "";
  const action = options?.action ?? options?.cancel;
  id = toastManager.add({
    title,
    description: options?.description,
    type: "loading",
    ...(options?.persistent ? { timeout: 0 } : {}),
    actionProps: action
      ? {
          children: action.label,
          onClick: () => {
            action.onClick?.();
            toastManager.close(id);
          },
        }
      : undefined,
  });
  return id;
};
/** Changes a shown toast's text, such as a loading toast's progress. */
const update = (
  id: ToastId,
  changes: { title?: string; description?: string },
) => {
  if (!id) return;
  toastManager.update(id, changes);
};
const dismiss = (id?: ToastId) => {
  if (!id) return;
  toastManager.close(id);
};

const toast = Object.assign(message, {
  success,
  error,
  info,
  warning,
  message,
  loading,
  update,
  dismiss,
});

export type { ToastOptions };
export { toast };
