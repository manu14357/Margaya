import { createFileRoute } from "@tanstack/react-router";
import { Inbox } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ClearingIllustration } from "@/components/illustrations/clearing";
import { EmptyState } from "@/components/ui/empty";
import { ErrorDisplay } from "@/components/ui/error-display";
import { CrashFallback, NotFoundPage } from "@/components/ui/error-fallback";
import {
  BoardColumnsSkeleton,
  CardGridSkeleton,
  ListRowsSkeleton,
  LoadingSkeleton,
  PageSkeleton,
} from "@/components/ui/loading-skeleton";

// A preview of the shared empty, loading and error states:
// /test-error?state=error|offline|network|notFound|crash|empty|emptyIcon|list|board|cards|shell|throw

const STATES = [
  "error",
  "offline",
  "network",
  "notFound",
  "crash",
  "empty",
  "emptyIcon",
  "list",
  "board",
  "cards",
  "shell",
  "throw",
] as const;

type PreviewState = (typeof STATES)[number];

export const Route = createFileRoute("/test-error")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { state?: PreviewState } =>
    STATES.includes(search.state as PreviewState)
      ? { state: search.state as PreviewState }
      : {},
  component: TestErrorComponent,
});

const sampleError = new Error(
  "Request to /api/tasks failed with status 500: internal server error",
);

function ThrowOnRender(): never {
  throw new Error("Preview: a route that failed while rendering");
}

function StatePreview({ state }: { state: PreviewState }) {
  const { t } = useTranslation();
  switch (state) {
    case "offline":
      return <ErrorDisplay error={sampleError} kind="offline" onRetry={noop} />;
    case "network":
      return (
        <ErrorDisplay error={new Error("Failed to fetch")} onRetry={noop} />
      );
    case "notFound":
      return <NotFoundPage />;
    case "crash":
      return <CrashFallback error={sampleError} resetError={noop} />;
    case "empty":
      return (
        <EmptyState
          description={t("common:states.empty.description")}
          illustration={<ClearingIllustration />}
          title={t("common:states.empty.title")}
        />
      );
    case "emptyIcon":
      return (
        <EmptyState
          description={t("common:states.empty.description")}
          icon={<Inbox />}
          title={t("common:states.empty.title")}
        />
      );
    case "list":
      return (
        <PageSkeleton>
          <ListRowsSkeleton className="rounded-xl border" />
        </PageSkeleton>
      );
    case "board":
      return <BoardColumnsSkeleton />;
    case "cards":
      return (
        <PageSkeleton>
          <CardGridSkeleton />
        </PageSkeleton>
      );
    case "shell":
      return <LoadingSkeleton />;
    case "throw":
      return <ThrowOnRender />;
    default:
      return <ErrorDisplay error={sampleError} onRetry={noop} />;
  }
}

function noop() {}

function TestErrorComponent() {
  const { state = "error" } = Route.useSearch();
  return (
    <main className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto bg-background">
      <StatePreview state={state} />
    </main>
  );
}
