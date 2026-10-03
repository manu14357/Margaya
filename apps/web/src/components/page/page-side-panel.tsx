import type { Editor } from "@tiptap/core";
import { X } from "lucide-react";
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

const WIDE_QUERY = "(min-width: 1280px)";

/** True at the `xl` breakpoint and up, where the panel sits beside the page. */
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

type PageSidePanelProps = {
  page: Page;
  workspaceId: string;
  editor: Editor | null;
  panel: PagePanel | undefined;
  onPanelChange: (panel: PagePanel | undefined) => void;
  versionId?: string;
  onVersionSelect: (versionId: string | undefined) => void;
  getMember: (userId: string | null | undefined) => PageMember | null;
};

const PANELS: PagePanel[] = ["outline", "info", "history"];
const PANEL_KEYS: Record<PagePanel, string> = {
  outline: "pages:panel.outline",
  info: "pages:panel.info",
  history: "pages:panel.history",
};

/** Outline · Info · History (§1.11, §1.12), beside the page or in a sheet. */
export default function PageSidePanel({
  page,
  workspaceId,
  editor,
  panel,
  onPanelChange,
  versionId,
  onVersionSelect,
  getMember,
}: PageSidePanelProps) {
  const { t } = useTranslation();
  const isWide = useIsWideLayout();
  if (!panel) return null;

  const content = (
    <Tabs
      value={panel}
      onValueChange={(value) => onPanelChange(value as PagePanel)}
      className="flex h-full min-h-0 flex-col gap-0"
    >
      <div className="flex items-center justify-between gap-2 border-border/80 border-b px-2">
        <TabsList variant="underline" className="h-10 gap-1 py-0">
          {PANELS.map((value) => (
            <TabsTab key={value} value={value} className="h-8 px-2 text-xs">
              {t(PANEL_KEYS[value])}
            </TabsTab>
          ))}
        </TabsList>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t("pages:panel.close")}
          onClick={() => onPanelChange(undefined)}
        >
          <X className="size-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
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
        aria-label={t(PANEL_KEYS[panel])}
        className="hidden w-72 shrink-0 border-border/80 border-l xl:flex xl:flex-col"
      >
        {content}
      </aside>
    );
  }

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onPanelChange(undefined);
      }}
    >
      <SheetContent side="right" className="p-0" showCloseButton={false}>
        <SheetTitle className="sr-only">{t(PANEL_KEYS[panel])}</SheetTitle>
        {content}
      </SheetContent>
    </Sheet>
  );
}
