import type { Editor } from "@tiptap/core";
import { PanelRightClose } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs";
import type { Page, PagePanel } from "@/types/page";
import PageInfo from "./page-info";
import PageOutline from "./page-outline";
import PageVersionList from "./page-version-list";
import type { PageMember } from "./use-page-members";

const WIDE_QUERY = "(min-width: 1024px)";
/** Matches the pane's width transition in page-editor.css. */
const PANE_TRANSITION_MS = 250;

/** True at the `lg` breakpoint and up, where the panel sits beside the page. */
export function useIsWideLayout() {
  const [isWide, setIsWide] = useState(() =>
    typeof window === "undefined" || !window.matchMedia
      ? true
      : window.matchMedia(WIDE_QUERY).matches,
  );
  useEffect(() => {
    if (!window.matchMedia) return;
    const media = window.matchMedia(WIDE_QUERY);
    const update = () => setIsWide(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return isWide;
}

/**
 * Keeps the docked pane mounted while it animates: it mounts closed, opens
 * on the next frame, and unmounts once the closing transition has run.
 */
function usePaneTransition(panel: PagePanel | undefined) {
  const [shownPanel, setShownPanel] = useState(panel);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (panel) {
      setShownPanel(panel);
      const frame = window.requestAnimationFrame(() => setOpen(true));
      return () => window.cancelAnimationFrame(frame);
    }
    setOpen(false);
    const timer = window.setTimeout(
      () => setShownPanel(undefined),
      PANE_TRANSITION_MS,
    );
    return () => window.clearTimeout(timer);
  }, [panel]);

  return { shownPanel: panel ?? shownPanel, open: Boolean(panel) && open };
}

type PageSidePanelProps = {
  page: Page;
  workspaceId: string;
  editor: Editor | null;
  panel: PagePanel | undefined;
  onPanelChange: (panel: PagePanel | undefined) => void;
  /** Close: after the panel closes, focus returns to its toggle. */
  onClose?: () => void;
  versionId?: string;
  onVersionSelect: (versionId: string | undefined) => void;
  getMember: (userId: string | null | undefined) => PageMember | null;
};

export const PANELS: PagePanel[] = ["outline", "info", "history"];
const PANEL_KEYS: Record<PagePanel, string> = {
  outline: "pages:panel.outline",
  info: "pages:panel.info",
  history: "pages:panel.history",
};

/**
 * Outline · Info · History (§1.11, §1.12): docked beside the page from
 * 1024px, where it slides open and the text column re-centres; a sheet
 * below that.
 */
export default function PageSidePanel({
  page,
  workspaceId,
  editor,
  panel,
  onPanelChange,
  onClose,
  versionId,
  onVersionSelect,
  getMember,
}: PageSidePanelProps) {
  const { t } = useTranslation();
  const isWide = useIsWideLayout();
  const { shownPanel, open } = usePaneTransition(panel);
  const close = () => {
    onPanelChange(undefined);
    onClose?.();
  };

  if (!shownPanel) return null;

  const content = (
    <Tabs
      value={shownPanel}
      onValueChange={(value) => onPanelChange(value as PagePanel)}
      className="flex h-full min-h-0 flex-col gap-0"
    >
      <div className="flex h-10 shrink-0 items-center px-3">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("pages:panel.close")}
          className="text-muted-foreground"
          onClick={close}
        >
          <PanelRightClose className="size-4" />
        </Button>
      </div>
      <div className="shrink-0 px-3 pt-2">
        <TabsList className="h-7 w-full rounded-md">
          {PANELS.map((value) => (
            <TabsTab
              key={value}
              value={value}
              className="h-6 px-2 text-xs sm:h-6 sm:text-xs"
            >
              {t(PANEL_KEYS[value])}
            </TabsTab>
          ))}
        </TabsList>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
        <TabsPanel value="outline">
          <PageOutline editor={editor} />
        </TabsPanel>
        <TabsPanel value="info">
          <PageInfo
            page={page}
            workspaceId={workspaceId}
            editor={editor}
            getMember={getMember}
          />
        </TabsPanel>
        <TabsPanel value="history">
          <PageVersionList
            pageId={page.id}
            selectedVersionId={versionId}
            onSelect={onVersionSelect}
            getMember={getMember}
          />
        </TabsPanel>
      </div>
    </Tabs>
  );

  if (isWide) {
    return (
      <aside
        aria-label={t(PANEL_KEYS[shownPanel])}
        data-open={open}
        data-slot="page-side-panel"
        className="margaya-page-pane hidden shrink-0 border-border/80 border-l bg-background lg:flex lg:flex-col"
      >
        <div className="flex h-full min-h-0 flex-col">{content}</div>
      </aside>
    );
  }

  if (!panel) return null;

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <SheetContent side="right" className="p-0" showCloseButton={false}>
        <SheetTitle className="sr-only">{t(PANEL_KEYS[panel])}</SheetTitle>
        {content}
      </SheetContent>
    </Sheet>
  );
}
