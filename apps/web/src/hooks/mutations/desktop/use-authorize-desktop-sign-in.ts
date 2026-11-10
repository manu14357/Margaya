import { useMutation } from "@tanstack/react-query";
import authorizeDesktopSignIn from "@/fetchers/desktop/authorize-desktop-sign-in";

export function useAuthorizeDesktopSignIn() {
  return useMutation({
    mutationFn: authorizeDesktopSignIn,
    meta: { refreshTaskQueries: false },
  });
}
