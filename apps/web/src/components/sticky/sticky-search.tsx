import { Search, X } from "lucide-react";
import {
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import debounce from "@/lib/debounce";

export const STICKY_SEARCH_MAX_LENGTH = 200;
const SEARCH_DEBOUNCE_MS = 300;

/**
 * "/" pressed on the page or widget itself, not while typing in a field or
 * a sticky (where it opens the editor's command menu).
 */
export function isSearchShortcut(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) {
    return false;
  }
  const target = event.target as HTMLElement | null;
  return !target?.closest('input, textarea, select, [contenteditable="true"]');
}

type StickySearchProps = {
  /** The applied (debounced, trimmed) query. */
  query: string;
  onQueryChange: (query: string) => void;
  /** Bumped by the parent to open the field (the "/" shortcut). */
  openSignal?: number;
};

/** A search toggle that expands into a debounced input. */
export default function StickySearch({
  query,
  onQueryChange,
  openSignal = 0,
}: StickySearchProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(query !== "");
  const [text, setText] = useState(query);
  const inputRef = useRef<HTMLInputElement>(null);
  const onQueryChangeRef = useRef(onQueryChange);
  onQueryChangeRef.current = onQueryChange;

  const applyDebounced = useMemo(
    () =>
      debounce((value: string) => {
        onQueryChangeRef.current(value.trim());
      }, SEARCH_DEBOUNCE_MS),
    [],
  );

  useEffect(() => () => applyDebounced.cancel(), [applyDebounced]);

  // A query cleared from outside (Add sticky, Clear search) empties the field.
  useEffect(() => {
    if (query === "") setText((current) => (current.trim() ? "" : current));
  }, [query]);

  useEffect(() => {
    if (openSignal > 0) setOpen(true);
  }, [openSignal]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const clear = () => {
    applyDebounced.cancel();
    setText("");
    onQueryChange("");
  };

  if (!open) {
    return (
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={t("stickies:search.open")}
        title={t("stickies:search.open")}
        onClick={() => setOpen(true)}
      >
        <Search />
      </Button>
    );
  }

  return (
    <div className="relative w-40 sm:w-56">
      <Search
        className="pointer-events-none absolute start-2 top-1/2 z-10 size-3.5 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        ref={inputRef}
        size="sm"
        type="search"
        value={text}
        maxLength={STICKY_SEARCH_MAX_LENGTH}
        placeholder={t("stickies:search.placeholder")}
        aria-label={t("stickies:search.placeholder")}
        className="[&_input]:ps-7 [&_input]:pe-7"
        onChange={(event) => {
          setText(event.target.value);
          applyDebounced(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          if (text) clear();
          else setOpen(false);
        }}
        onBlur={() => {
          if (!text.trim()) setOpen(false);
        }}
      />
      {text && (
        <button
          type="button"
          className="absolute end-1.5 top-1/2 z-10 flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:text-foreground"
          aria-label={t("stickies:search.clear")}
          onMouseDown={(event) => event.preventDefault()}
          onClick={clear}
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}
