import {
  createBoardDoc,
  parseSettings,
  sanitizeElements,
} from "@margaya/whiteboard";
import { Link2Off } from "lucide-react";
import { useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import { MargayaBranding } from "@/components/public-project/margaya-branding";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { WhiteboardEditor } from "@/components/whiteboard/editor/whiteboard-editor";
import { useBoardTheme } from "@/components/whiteboard/use-board-theme";
import WhiteboardIcon from "@/components/whiteboard/whiteboard-icon";
import { usePublicWhiteboard } from "@/hooks/queries/whiteboard/use-public-whiteboard";
import { formatDateMedium } from "@/lib/format";
import { publicWhiteboardAssetUrl } from "@/lib/whiteboards/whiteboard-paths";

/** Keeps search engines away from the public copy (the API says so too). */
function useNoIndex() {
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex";
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);
}

function Unavailable() {
  const { t } = useTranslation();
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-24">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <Link2Off className="size-6 text-muted-foreground" aria-hidden="true" />
        <div className="space-y-1.5">
          <h1 className="font-heading font-semibold text-2xl">
            {t("whiteboards:publicView.unavailableTitle")}
          </h1>
          <p className="text-muted-foreground text-sm">
            {t("whiteboards:publicView.unavailableDescription")}
          </p>
        </div>
      </div>
    </main>
  );
}

/**
 * A published board without app chrome: a slim header with its name, the
 * read-only canvas filling the window, then a quiet footer.
 */
export default function PublicWhiteboardView({ token }: { token: string }) {
  const { t } = useTranslation();
  const board = usePublicWhiteboard(token);
  const theme = useBoardTheme();
  useNoIndex();

  const data = board.data;
  const doc = useMemo(
    () =>
      data
        ? createBoardDoc(
            sanitizeElements(data.elements),
            parseSettings(data.settings),
          )
        : null,
    [data],
  );
  useEffect(() => () => doc?.destroy(), [doc]);
  const imageUrl = useCallback(
    (assetId: string) => publicWhiteboardAssetUrl(token, assetId),
    [token],
  );

  const title = data?.title.trim() || t("whiteboards:list.untitled");

  return (
    <div className="flex h-dvh w-full flex-col bg-background text-foreground">
      <PageTitle
        title={data ? title : t("whiteboards:publicView.documentTitle")}
        hideAppName={false}
      />
      {board.isLoading ? (
        <main className="flex flex-1 flex-col">
          <div className="flex h-12 items-center gap-2 border-border/80 border-b px-4">
            <Skeleton className="h-5 w-48" />
          </div>
          <div className="flex flex-1 items-center justify-center bg-muted/30">
            <Skeleton className="h-2/3 w-2/3 max-w-3xl rounded-xl" />
          </div>
        </main>
      ) : board.isError || !data || !doc ? (
        <Unavailable />
      ) : (
        <main className="flex min-h-0 flex-1 flex-col">
          <header className="flex h-12 shrink-0 items-center gap-2 border-border/80 border-b px-4">
            <WhiteboardIcon icon={data.icon} />
            <h1 className="min-w-0 truncate font-semibold text-sm">{title}</h1>
            <Badge variant="outline" className="shrink-0">
              {t("whiteboards:publicView.readOnly")}
            </Badge>
            <p className="ms-auto hidden shrink-0 text-muted-foreground text-xs tabular-nums sm:block">
              {t("whiteboards:publicView.updated", {
                date: formatDateMedium(data.updatedAt),
              })}
            </p>
          </header>
          <div className="relative min-h-0 flex-1 overflow-hidden">
            <WhiteboardEditor
              key={doc.guid}
              doc={doc}
              awareness={null}
              readOnly
              user={null}
              workspaceId=""
              projectId=""
              whiteboardId=""
              theme={theme}
              imageUrl={imageUrl}
              isPublic
              publicTasks={data.tasks}
            />
          </div>
        </main>
      )}
      <footer className="flex shrink-0 justify-center px-4 py-3 text-muted-foreground text-xs">
        <MargayaBranding />
      </footer>
    </div>
  );
}
