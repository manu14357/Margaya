import { ChevronRight } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Radio, RadioGroup } from "@/components/ui/radio-group";
import { cn } from "@/lib/cn";
import {
  ALL_EVENTS_PATTERN,
  allFamiliesSelection,
  type CatalogLike,
  familyState,
  isEventSelected,
  patternsFromSelection,
  selectionFromPatterns,
  toggleEvent,
  toggleFamily,
} from "@/lib/webhook/patterns";
import { useFamilyText } from "./webhook-family-labels";

type WebhookEventsPickerProps = {
  catalog: CatalogLike;
  /** The subscription patterns. */
  value: string[];
  onChange: (patterns: string[]) => void;
  disabled?: boolean;
  /** Show the empty-selection error even before the picker was touched. */
  showErrors?: boolean;
};

type Family = CatalogLike["families"][number];

function matchesQuery(family: Family, query: string, label: string) {
  if (!query) return family.events;
  if (label.toLowerCase().includes(query) || family.key.includes(query)) {
    return family.events;
  }
  return family.events.filter((event) => event.name.includes(query));
}

/** "All events" or a family-grouped, filterable checklist of events. */
export function WebhookEventsPicker({
  catalog,
  value,
  onChange,
  disabled,
  showErrors = false,
}: WebhookEventsPickerProps) {
  const { t } = useTranslation();
  const familyText = useFamilyText();
  const id = useId();
  const [mode, setMode] = useState<"all" | "custom">(
    value.includes(ALL_EVENTS_PATTERN) ? "all" : "custom",
  );
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [touched, setTouched] = useState(false);
  // Switching to "All events" and back restores the hand-picked events.
  const lastCustom = useRef<string[]>(
    value.includes(ALL_EVENTS_PATTERN) ? [] : value,
  );

  const selection = useMemo(
    () =>
      value.includes(ALL_EVENTS_PATTERN)
        ? allFamiliesSelection(catalog)
        : selectionFromPatterns(value, catalog),
    [value, catalog],
  );
  const normalizedQuery = query.trim().toLowerCase();
  const visibleFamilies = catalog.families
    .map((family) => ({
      family,
      events: matchesQuery(
        family,
        normalizedQuery,
        familyText(family.key).label,
      ),
    }))
    .filter(({ events }) => events.length > 0);

  const emit = (patterns: string[]) => {
    setTouched(true);
    lastCustom.current = patterns;
    onChange(patterns);
  };

  const showRequired =
    mode === "custom" && value.length === 0 && (touched || showErrors);

  return (
    <div className="space-y-3">
      <RadioGroup
        className="gap-2"
        value={mode}
        disabled={disabled}
        onValueChange={(next) => {
          if (next === "all") {
            setMode("all");
            onChange([ALL_EVENTS_PATTERN]);
          } else {
            setMode("custom");
            setTouched(true);
            onChange(lastCustom.current);
          }
        }}
      >
        <label className="flex items-start gap-3" htmlFor={`${id}-all`}>
          <Radio className="mt-0.5" id={`${id}-all`} value="all" />
          <div className="min-w-0 space-y-0.5">
            <p className="font-medium text-sm">
              {t("settings:workspaceWebhooks.form.eventsAll")}
            </p>
            <p className="text-muted-foreground text-xs">
              {t("settings:workspaceWebhooks.form.eventsAllHint")}
            </p>
          </div>
        </label>
        <label className="flex items-start gap-3" htmlFor={`${id}-custom`}>
          <Radio className="mt-0.5" id={`${id}-custom`} value="custom" />
          <div className="min-w-0 space-y-0.5">
            <p className="font-medium text-sm">
              {t("settings:workspaceWebhooks.form.eventsChoose")}
            </p>
            <p className="text-muted-foreground text-xs">
              {t("settings:workspaceWebhooks.form.eventsChooseHint")}
            </p>
          </div>
        </label>
      </RadioGroup>

      {mode === "custom" && (
        <div className="space-y-2">
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("settings:workspaceWebhooks.form.eventsSearch")}
            aria-label={t("settings:workspaceWebhooks.form.eventsSearch")}
            disabled={disabled}
          />
          <div className="max-h-80 divide-y overflow-y-auto rounded-lg border">
            {visibleFamilies.length === 0 && (
              <p className="px-3 py-6 text-center text-muted-foreground text-sm">
                {t("settings:workspaceWebhooks.form.eventsNoMatch")}
              </p>
            )}
            {visibleFamilies.map(({ family, events }) => {
              const { label, description } = familyText(family.key);
              const state = familyState(selection, family);
              const isOpen = Boolean(normalizedQuery) || open.has(family.key);
              return (
                <Collapsible
                  key={family.key}
                  open={isOpen}
                  onOpenChange={(next) =>
                    setOpen((current) => {
                      const updated = new Set(current);
                      if (next) updated.add(family.key);
                      else updated.delete(family.key);
                      return updated;
                    })
                  }
                >
                  <div className="flex items-start gap-2 px-3 py-2">
                    <Checkbox
                      className="mt-0.5"
                      aria-label={label}
                      checked={state === "checked"}
                      indeterminate={state === "indeterminate"}
                      disabled={disabled}
                      onCheckedChange={(checked) =>
                        emit(
                          patternsFromSelection(
                            toggleFamily(selection, family.key, checked),
                            catalog,
                          ),
                        )
                      }
                    />
                    <CollapsibleTrigger className="flex min-w-0 flex-1 items-start gap-1 text-left">
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <p className="font-medium text-sm">{label}</p>
                        <p className="text-muted-foreground text-xs">
                          {description}
                        </p>
                      </div>
                      <ChevronRight
                        className={cn(
                          "mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform",
                          isOpen && "rotate-90",
                        )}
                      />
                    </CollapsibleTrigger>
                  </div>
                  <CollapsibleContent>
                    <ul className="space-y-1 pb-2 pl-9">
                      {events.map((event) => (
                        <li
                          key={event.name}
                          className="flex items-center gap-2"
                        >
                          <Checkbox
                            aria-label={event.name}
                            checked={isEventSelected(
                              selection,
                              family.key,
                              event.name,
                            )}
                            disabled={disabled}
                            onCheckedChange={(checked) =>
                              emit(
                                patternsFromSelection(
                                  toggleEvent(
                                    selection,
                                    family,
                                    event.name,
                                    checked,
                                  ),
                                  catalog,
                                ),
                              )
                            }
                          />
                          <code className="font-mono text-xs">
                            {event.name}
                          </code>
                        </li>
                      ))}
                    </ul>
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
          </div>
          {showRequired && (
            <p role="alert" className="text-destructive-foreground text-xs">
              {t("settings:workspaceWebhooks.form.eventsRequired")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default WebhookEventsPicker;
