import { create } from "zustand";

/**
 * The one Send feedback dialog (FeedbackHost in the app shell). The help
 * menu and the command palette open it from anywhere.
 */
type FeedbackDialogState = {
  open: boolean;
  setOpen: (open: boolean) => void;
};

export const useFeedbackDialog = create<FeedbackDialogState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

export function openFeedbackDialog() {
  useFeedbackDialog.getState().setOpen(true);
}
