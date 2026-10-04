import { Check, ChevronsUpDown, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  filterTimeZones,
  listTimeZones,
  timeZoneOffsetLabel,
} from "@/lib/timezones";

type TimezoneSelectProps = {
  id?: string;
  /** The selected zone; null shows the leading option (or a placeholder). */
  value: string | null;
  onChange: (zone: string) => void;
  disabled?: boolean;
  /** Accessible name of the trigger and the list. */
  label: string;
  /** A leading row such as "Automatic (browser)", selected while value is null. */
  leading?: { label: string; onSelect: () => void };
};

function zoneLabel(zone: string): string {
  const offset = timeZoneOffsetLabel(zone);
  const name = zone.replace(/_/g, " ");
  // UTC itself needs no "(GMT+0)" suffix.
  return offset && zone !== "UTC" ? `${name} (${offset})` : name;
}

/** A searchable list of IANA time zones. */
export default function TimezoneSelect({
  id,
  value,
  onChange,
  disabled,
  label,
  leading,
}: TimezoneSelectProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const zones = useMemo(() => {
    const all = listTimeZones();
    // Keep a stored zone the browser does not list (e.g. an old alias).
    return value && !all.includes(value) ? [value, ...all] : all;
  }, [value]);
  const visible = useMemo(() => filterTimeZones(zones, query), [zones, query]);

  const choose = (zone: string) => {
    setOpen(false);
    setQuery("");
    if (zone !== value) onChange(zone);
  };

  const triggerText = value
    ? zoneLabel(value)
    : (leading?.label ?? t("settings:timezone.placeholder"));

  const rowClassName =
    "flex h-8 w-full items-center gap-2 px-2 text-left text-sm transition-colors hover:bg-accent/50";

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          aria-label={`${label}: ${triggerText}`}
          className="w-full justify-between font-normal sm:w-64"
        >
          <span className="truncate">{triggerText}</span>
          <ChevronsUpDown className="size-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 max-w-[calc(100vw-2rem)] p-0" align="end">
        <div className="flex items-center gap-2 border-border border-b p-2">
          <Search className="size-3 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("settings:timezone.search")}
            aria-label={t("settings:timezone.search")}
            className="h-auto border-none p-0 shadow-none focus-visible:ring-0 !bg-transparent"
          />
        </div>
        <div
          role="listbox"
          aria-label={label}
          className="max-h-72 overflow-y-auto py-1"
        >
          {leading && !query.trim() && (
            <button
              type="button"
              role="option"
              aria-selected={value === null}
              className={rowClassName}
              onClick={() => {
                setOpen(false);
                leading.onSelect();
              }}
            >
              <span className="flex w-4 shrink-0 justify-center">
                {value === null && <Check className="size-3.5" />}
              </span>
              <span className="truncate">{leading.label}</span>
            </button>
          )}
          {visible.map((zone) => (
            <button
              key={zone}
              type="button"
              role="option"
              aria-selected={zone === value}
              className={rowClassName}
              onClick={() => choose(zone)}
            >
              <span className="flex w-4 shrink-0 justify-center">
                {zone === value && <Check className="size-3.5" />}
              </span>
              <span className="truncate">{zoneLabel(zone)}</span>
            </button>
          ))}
          {visible.length === 0 && (
            <p className="px-2 py-2 text-muted-foreground text-xs">
              {t("settings:timezone.noResults")}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
