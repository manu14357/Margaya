import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";

const DEBOUNCE_MS = 300;

/** The board search; it writes the URL once typing pauses. */
export default function PublicBoardSearch({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (q: string) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(value);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // The URL wins when it changes elsewhere (Clear filters, back button).
  useEffect(() => setDraft(value), [value]);

  useEffect(() => {
    if (draft.trim() === value.trim()) return;
    const timer = setTimeout(() => onChangeRef.current(draft), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, value]);

  return (
    <div className={cn("relative", className)}>
      <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 z-10 size-3.5 text-muted-foreground" />
      <Input
        type="search"
        size="sm"
        value={draft}
        maxLength={100}
        aria-label={t("publicProject:board.searchPlaceholder")}
        placeholder={t("publicProject:board.searchPlaceholder")}
        onChange={(event) => setDraft(event.target.value)}
        className="w-full [&_input]:ps-8"
      />
    </div>
  );
}
