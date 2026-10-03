import { type KeyboardEvent, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import type { PageSummary } from "@/types/page";
import PageLogo from "../page-logo";

type PageLinkPickerProps = {
  pages: PageSummary[];
  top: number;
  left: number;
  onSelect: (page: PageSummary) => void;
  onClose: () => void;
};

const MAX_RESULTS = 30;

/** "Link to page": a searchable list of the project's pages. */
export default function PageLinkPicker({
  pages,
  top,
  left,
  onSelect,
  onClose,
}: PageLinkPickerProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const untitled = t("pages:list.untitled");

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return pages
      .filter((page) =>
        (page.title.trim() || untitled).toLowerCase().includes(needle),
      )
      .slice(0, MAX_RESULTS);
  }, [pages, query, untitled]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (results.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setSelectedIndex(
        (index) => (index + step + results.length) % results.length,
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      const page = results[Math.min(selectedIndex, results.length - 1)];
      if (page) onSelect(page);
    }
  };

  return (
    <div
      className="margaya-tiptap-slash-menu w-72"
      style={{ top, left, position: "absolute" }}
    >
      <div className="p-1">
        <Input
          size="sm"
          autoFocus
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelectedIndex(0);
          }}
          onKeyDown={onKeyDown}
          onBlur={onClose}
          placeholder={t("pages:editor.pageLinkPicker.search")}
          aria-label={t("pages:editor.pageLinkPicker.search")}
        />
      </div>
      {results.length > 0 ? (
        <div className="margaya-tiptap-slash-group" role="listbox">
          {results.map((page, index) => (
            <button
              key={page.id}
              type="button"
              role="option"
              aria-selected={index === selectedIndex}
              className={cn(
                "margaya-tiptap-slash-item gap-2",
                index === selectedIndex && "is-selected",
              )}
              onMouseEnter={() => setSelectedIndex(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                onSelect(page);
              }}
            >
              <PageLogo logoKind={page.logoKind} logoValue={page.logoValue} />
              <span className="margaya-tiptap-slash-label truncate">
                {page.title.trim() || untitled}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="margaya-tiptap-slash-empty">
          {t("pages:editor.pageLinkPicker.empty")}
        </div>
      )}
    </div>
  );
}
