import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PAGE_EMOJI_CATEGORIES } from "@/constants/page-emojis";
import { cn } from "@/lib/cn";

type WhiteboardIconDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  current: string | null;
  onChoose: (icon: string | null) => void;
};

/** Picks a board's emoji (the pages' curated set), or removes it. */
export default function WhiteboardIconDialog({
  open,
  onOpenChange,
  current,
  onChoose,
}: WhiteboardIconDialogProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");

  const emojis = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const all = PAGE_EMOJI_CATEGORIES.flatMap((category) => category.emojis);
    return needle ? all.filter((item) => item.keywords.includes(needle)) : all;
  }, [query]);

  const choose = (icon: string | null) => {
    onChoose(icon);
    onOpenChange(false);
    setQuery("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("whiteboards:dialogs.icon.title")}</DialogTitle>
          <DialogDescription>
            {t("whiteboards:dialogs.icon.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 px-6 pb-2">
          <Input
            value={query}
            maxLength={40}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("whiteboards:dialogs.icon.search")}
            aria-label={t("whiteboards:dialogs.icon.search")}
          />
          {emojis.length === 0 ? (
            <p className="py-6 text-center text-muted-foreground text-sm">
              {t("whiteboards:dialogs.icon.noMatches")}
            </p>
          ) : (
            <div
              role="listbox"
              aria-label={t("whiteboards:dialogs.icon.title")}
              className="grid max-h-64 grid-cols-8 gap-1 overflow-y-auto"
            >
              {emojis.map((item) => (
                <button
                  key={item.emoji}
                  type="button"
                  role="option"
                  aria-selected={item.emoji === current}
                  aria-label={item.keywords.split(" ")[0] ?? item.emoji}
                  className={cn(
                    "flex aspect-square items-center justify-center rounded-md text-xl outline-none transition-colors duration-150 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                    item.emoji === current && "bg-accent",
                  )}
                  onClick={() => choose(item.emoji)}
                >
                  {item.emoji}
                </button>
              ))}
            </div>
          )}
        </div>
        <DialogFooter>
          {current && (
            <Button variant="ghost" onClick={() => choose(null)}>
              {t("whiteboards:dialogs.icon.remove")}
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("whiteboards:dialogs.cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
