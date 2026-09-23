import { createFileRoute, redirect } from "@tanstack/react-router";
import { authClient } from "@/lib/auth-client";
import { isSigningOut } from "@/lib/sign-out";

export const Route = createFileRoute("/auth")({
  beforeLoad: async () => {
    let session = null;
    try {
      const { data } = await authClient.getSession();
      session = data;
    } catch (error) {
      if (import.meta.env.DEV) console.warn("getSession failed", error);
      // getSession() rejected (e.g. network error) — treat as unauthenticated, allow auth pages to render
    }
    // A sign-out shows this page before the session ends; never bounce it.
    if (session && !isSigningOut()) {
      throw redirect({
        to: "/dashboard",
      });
    }
    return { session };
  },
});
