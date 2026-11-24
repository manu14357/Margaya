import type { QueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { getConfig } from "@/fetchers/config/get-config";
import { isDesktopApp } from "@/lib/desktop";

// Its own chunk: signed-in visitors redirect in beforeLoad and never load it.
const PublicLanding = lazy(() => import("@/components/landing/public-landing"));

/** Shares the `["config"]` cache with `useGetConfig`. */
async function isPublicLandingEnabled(queryClient: QueryClient) {
  try {
    const config = await queryClient.ensureQueryData({
      queryKey: ["config"],
      queryFn: getConfig,
    });
    return config.publicLandingEnabled === true;
  } catch {
    // Unknown config: keep the old behaviour (dashboard, then sign-in).
    return false;
  }
}

export const Route = createFileRoute("/")({
  // The auth provider resolves the session before the router renders, so
  // `user` is settled here and a signed-in visitor never sees the landing.
  beforeLoad: async ({ context }) => {
    if (context.user) throw redirect({ to: "/dashboard" });
    // The desktop app's server window opens at the web root: a signed-out
    // person there wants to sign in, not the product's marketing page.
    if (isDesktopApp()) throw redirect({ to: "/auth/sign-in" });
    if (!(await isPublicLandingEnabled(context.queryClient))) {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: RootLanding,
});

function RootLanding() {
  return (
    <Suspense fallback={null}>
      <PublicLanding />
    </Suspense>
  );
}
