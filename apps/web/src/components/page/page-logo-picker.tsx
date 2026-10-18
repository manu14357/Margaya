import { SmilePlus } from "lucide-react";
import { type ReactElement, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs";
import {
  PAGE_EMOJI_CATEGORIES,
  type PageEmojiCategory,
} from "@/constants/page-emojis";
import projectIcons from "@/constants/project-icons";
import { useUpdatePage } from "@/hooks/mutations/page/use-update-page";
import { cn } from "@/lib/cn";
import { pageErrorMessage } from "@/lib/pages/page-errors";
import { toast } from "@/lib/toast";
import type { PageSummary } from "@/types/page";
import PageLogo from "./page-logo";

const CATEGORY_KEYS: Record<PageEmojiCategory, string> = {
  smileys: "pages:logo.categories.smileys",
  people: "pages:logo.categories.people",
  nature: "pages:logo.categories.nature",
  food: "pages:logo.categories.food",
  activities: "pages:logo.categories.activities",
  travel: "pages:logo.categories.travel",
  objects: "pages:logo.categories.objects",
  symbols: "pages:logo.categories.symbols",
};

type PageLogoPickerProps = {
  page: Pick<PageSummary, "id" | "projectId" | "logoKind" | "logoValue">;
  canEdit: boolean;
  /** Shows "Add icon" even without hover (an empty title). */
  emphasizeAdd?: boolean;
  /** Grows the icon box open: the icon was just set, not loaded with the page. */
  grow?: boolean;
};

/** The page's emoji or icon, and the picker that changes it. */
export default function PageLogoPicker({
  page,
  canEdit,
  emphasizeAdd,
  grow,
}: PageLogoPickerProps) {
  const { t } = useTranslation();
  const updatePage = useUpdatePage();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const hasLogo = Boolean(page.logoKind && page.logoValue);

  const categories = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return PAGE_EMOJI_CATEGORIES;
    return PAGE_EMOJI_CATEGORIES.map((category) => ({
      ...category,
      emojis: category.emojis.filter((item) => item.keywords.includes(needle)),
    })).filter((category) => category.emojis.length > 0);
  }, [query]);

  const save = (
    logoKind: "emoji" | "icon" | null,
    logoValue: string | null,
  ) => {
    setOpen(false);
    if (!page.projectId) return;
    updatePage.mutate(
      {
        pageId: page.id,
        projectId: page.projectId,
        json: { logoKind, logoValue },
      },
      {
        onError: (error) =>
          toast.error(pageErrorMessage(error) ?? t("pages:toasts.logoError")),
      },
    );
  };

  if (!canEdit) {
    return hasLogo ? (
      <span className="-ms-2 mt-2 inline-flex size-14 items-center justify-center">
        <PageLogo
          logoKind={page.logoKind}
          logoValue={page.logoValue}
          className="size-12 text-4xl"
        />
      </span>
    ) : null;
  }

  const trigger: ReactElement = hasLogo ? (
    <button
      type="button"
      aria-label={t("pages:editor.addIcon")}
      className={cn(
        "-ms-2 mt-2 inline-flex size-14 items-center justify-center rounded-lg outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
        grow && "margaya-page-logo-grow",
      )}
    />
  ) : (
    <Button
      variant="ghost"
      size="sm"
      className={cn(
        "h-7 gap-1 px-1.5 font-medium text-[13px] text-muted-foreground transition-opacity duration-150 sm:h-7",
        emphasizeAdd
          ? "opacity-100"
          : "opacity-0 focus-visible:opacity-100 group-focus-within/page-head:opacity-100 group-hover/page-head:opacity-100 pointer-coarse:opacity-100",
      )}
    />
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={trigger}>
        {hasLogo ? (
          <PageLogo
            logoKind={page.logoKind}
            logoValue={page.logoValue}
            className="size-12 text-4xl"
          />
        ) : (
          <>
            <SmilePlus className="size-4" />
            {t("pages:editor.addIcon")}
          </>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-2">
        <Tabs defaultValue="emoji">
          <div className="flex items-center justify-between gap-2">
            <TabsList variant="underline" className="h-8 py-0">
              <TabsTab value="emoji" className="h-7 px-2 text-xs">
                {t("pages:logo.emoji")}
              </TabsTab>
              <TabsTab value="icon" className="h-7 px-2 text-xs">
                {t("pages:logo.icon")}
              </TabsTab>
            </TabsList>
            {hasLogo && (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => save(null, null)}
              >
                {t("pages:logo.remove")}
              </Button>
            )}
          </div>
          <TabsPanel value="emoji" className="space-y-2">
            <Input
              size="sm"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("pages:logo.search")}
              aria-label={t("pages:logo.search")}
            />
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {categories.map((category) => (
                <div key={category.id}>
                  <p className="px-1 pb-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
                    {t(CATEGORY_KEYS[category.id])}
                  </p>
                  <div className="grid grid-cols-8 gap-0.5">
                    {category.emojis.map((item) => (
                      <button
                        key={item.emoji}
                        type="button"
                        title={item.keywords}
                        aria-label={item.keywords.split(" ")[0]}
                        onClick={() => save("emoji", item.emoji)}
                        className="flex size-8 items-center justify-center rounded-md text-lg hover:bg-accent"
                      >
                        {item.emoji}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </TabsPanel>
          <TabsPanel value="icon">
            <div className="grid max-h-64 grid-cols-8 gap-0.5 overflow-y-auto">
              {Object.entries(projectIcons).map(([name, Icon]) => (
                <button
                  key={name}
                  type="button"
                  title={name}
                  aria-label={name}
                  onClick={() => save("icon", name)}
                  className={cn(
                    "flex size-8 items-center justify-center rounded-md hover:bg-accent",
                    page.logoKind === "icon" &&
                      page.logoValue === name &&
                      "bg-accent",
                  )}
                >
                  <Icon className="size-4" />
                </button>
              ))}
            </div>
          </TabsPanel>
        </Tabs>
      </PopoverContent>
    </Popover>
  );
}
