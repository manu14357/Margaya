import { create } from "zustand";
import { HttpError } from "./http-error";
import { i18n } from "./i18n";

// Instance-admin changes need a recent sign-in. The API answers 403 with
// code REAUTH_REQUIRED; withReauth then opens the one confirmation dialog
// (ReauthDialog, rendered by every instance page) and retries the change
// once the password is confirmed.

export const REAUTH_REQUIRED = "REAUTH_REQUIRED";

function errorCode(error: unknown): string | null {
  if (!(error instanceof HttpError)) return null;
  try {
    const body = JSON.parse(error.message) as { code?: unknown };
    return typeof body.code === "string" ? body.code : null;
  } catch {
    return null;
  }
}

export function isReauthRequired(error: unknown): boolean {
  return (
    error instanceof HttpError &&
    error.status === 403 &&
    errorCode(error) === REAUTH_REQUIRED
  );
}

export function isWrongPassword(error: unknown): boolean {
  return (
    error instanceof HttpError &&
    error.status === 403 &&
    errorCode(error) === "INVALID_PASSWORD"
  );
}

type ReauthState = {
  open: boolean;
  resolve: ((confirmed: boolean) => void) | null;
  request: () => Promise<boolean>;
  settle: (confirmed: boolean) => void;
};

export const useReauthStore = create<ReauthState>((set, get) => ({
  open: false,
  resolve: null,
  request: () =>
    new Promise<boolean>((resolve) => {
      // A second change while the dialog is open waits for the same answer.
      const previous = get().resolve;
      set({
        open: true,
        resolve: (confirmed) => {
          previous?.(confirmed);
          resolve(confirmed);
        },
      });
    }),
  settle: (confirmed) => {
    const { resolve } = get();
    set({ open: false, resolve: null });
    resolve?.(confirmed);
  },
}));

/**
 * Runs an instance-admin change; when the server asks for a recent sign-in,
 * asks for it and runs the change once more.
 */
export async function withReauth<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!isReauthRequired(error)) throw error;
    const confirmed = await useReauthStore.getState().request();
    if (!confirmed) {
      throw new Error(i18n.t("accountSecurity:reauth.cancelled"));
    }
    return run();
  }
}
