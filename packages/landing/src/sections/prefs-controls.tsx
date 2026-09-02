"use client";

import {
  Check,
  ChevronDown,
  Languages,
  type LucideIcon,
  Monitor,
  Moon,
  Sun,
} from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { fill, useLandingCopy } from "../copy";
import { cn } from "../lib/cn";
import {
  hasLanguageChoice,
  LANDING_THEMES,
  type LandingTheme,
  useLandingPrefs,
} from "../prefs";

const FOCUS =
  "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background";

const THEME_ICONS: Record<LandingTheme, LucideIcon> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

type MenuOption = {
  value: string;
  label: string;
  lang?: string;
  icon?: LucideIcon;
};

/**
 * A single-choice menu button: arrow keys, Home and End move between
 * options; Enter or Space picks; Escape closes and returns focus; Tab, an
 * outside press or focus leaving it closes it.
 */
function ChoiceMenu({
  label,
  trigger,
  options,
  value,
  onSelect,
  className,
}: {
  label: string;
  trigger: ReactNode;
  options: MenuOption[];
  value: string;
  onSelect: (value: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );

  const focusItem = (index: number) => {
    const count = options.length;
    itemRefs.current[((index % count) + count) % count]?.focus();
  };

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  };

  // Focus the current choice once the menu is shown.
  useEffect(() => {
    if (open) itemRefs.current[selectedIndex]?.focus();
  }, [open, selectedIndex]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: Event) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("focusin", closeOutside);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("focusin", closeOutside);
    };
  }, [open]);

  const onButtonKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
    }
  };

  const onMenuKeyDown = (event: KeyboardEvent) => {
    const current = itemRefs.current.indexOf(
      document.activeElement as HTMLButtonElement,
    );
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusItem(current + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusItem(current - 1);
        break;
      case "Home":
        event.preventDefault();
        focusItem(0);
        break;
      case "End":
        event.preventDefault();
        focusItem(options.length - 1);
        break;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        close(true);
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  };

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={onButtonKeyDown}
        className={cn(
          "inline-flex h-9 items-center gap-1.5 rounded-md px-2 font-medium text-muted-foreground text-sm transition-colors hover:bg-accent hover:text-foreground aria-expanded:text-foreground",
          FOCUS,
        )}
      >
        {trigger}
      </button>
      <div
        id={menuId}
        role="menu"
        aria-label={label}
        hidden={!open}
        onKeyDown={onMenuKeyDown}
        className="absolute top-full right-0 z-50 mt-2 max-h-[min(70vh,26rem)] w-52 overflow-y-auto rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg"
      >
        {options.map((option, index) => {
          const selected = option.value === value;
          const Icon = option.icon;
          return (
            <button
              key={option.value}
              ref={(node) => {
                itemRefs.current[index] = node;
              }}
              type="button"
              role="menuitemradio"
              aria-checked={selected}
              tabIndex={-1}
              lang={option.lang}
              onClick={() => {
                onSelect(option.value);
                close(true);
              }}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-accent focus-visible:bg-accent",
                "outline-none",
                selected ? "font-medium text-foreground" : "text-foreground/85",
              )}
            >
              {Icon && (
                <Icon aria-hidden className="size-4 text-muted-foreground" />
              )}
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              <Check
                aria-hidden
                className={cn(
                  "size-4 shrink-0 text-primary",
                  !selected && "invisible",
                )}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The navbar's language menu, listing every locale by its own name. */
export function LandingLanguageMenu({ className }: { className?: string }) {
  const prefs = useLandingPrefs();
  const copy = useLandingCopy().home.prefs;
  if (!prefs || !hasLanguageChoice(prefs)) return null;

  const current =
    prefs.locales.find((locale) => locale.code === prefs.locale) ??
    prefs.locales[0];
  if (!current) return null;

  return (
    <ChoiceMenu
      className={className}
      label={fill(copy.languageCurrent, { language: current.nativeName })}
      value={current.code}
      onSelect={prefs.setLocale}
      options={prefs.locales.map((locale) => ({
        value: locale.code,
        label: locale.nativeName,
        lang: locale.code,
      }))}
      trigger={
        <>
          <Languages aria-hidden className="size-4" />
          <span lang={current.code} className="max-lg:hidden">
            {current.nativeName}
          </span>
          <ChevronDown aria-hidden className="size-3.5 max-lg:hidden" />
        </>
      }
    />
  );
}

/** The navbar's theme menu: Light, Dark or System. */
export function LandingThemeMenu({ className }: { className?: string }) {
  const prefs = useLandingPrefs();
  const copy = useLandingCopy().home.prefs;
  if (!prefs) return null;

  const Icon = THEME_ICONS[prefs.theme];
  return (
    <ChoiceMenu
      className={className}
      label={fill(copy.themeCurrent, { theme: copy[prefs.theme] })}
      value={prefs.theme}
      onSelect={(value) => prefs.setTheme(value as LandingTheme)}
      options={LANDING_THEMES.map((theme) => ({
        value: theme,
        label: copy[theme],
        icon: THEME_ICONS[theme],
      }))}
      trigger={<Icon aria-hidden className="size-4" />}
    />
  );
}

/**
 * Light / Dark / System as native radio buttons under a "Theme" legend, for
 * the mobile menu. Arrow keys move the choice, as in any radio group.
 * `compact` (the footer bar) shows icons only; the legend and the labels
 * stay for screen readers.
 */
export function LandingThemeSwitch({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const prefs = useLandingPrefs();
  const copy = useLandingCopy().home.prefs;
  const name = useId();
  if (!prefs) return null;

  return (
    <fieldset className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <legend
        className={cn(
          "mb-1.5 font-medium text-muted-foreground text-xs",
          compact && "sr-only",
        )}
      >
        {copy.theme}
      </legend>
      <div className="flex rounded-lg border border-border bg-background p-0.5">
        {LANDING_THEMES.map((theme) => {
          const Icon = THEME_ICONS[theme];
          return (
            <label
              key={theme}
              title={compact ? copy[theme] : undefined}
              className={cn(
                "inline-flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md text-muted-foreground text-sm transition-colors hover:text-foreground has-checked:bg-accent has-checked:font-medium has-checked:text-foreground has-focus-visible:ring-2 has-focus-visible:ring-ring",
                compact ? "size-7" : "h-9 px-3",
              )}
            >
              <input
                type="radio"
                name={name}
                value={theme}
                checked={prefs.theme === theme}
                onChange={() => prefs.setTheme(theme)}
                className="sr-only"
              />
              <Icon aria-hidden className={compact ? "size-3.5" : "size-4"} />
              <span className={cn(compact && "sr-only")}>{copy[theme]}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * A labelled native language select, for the mobile menu and the footer.
 * `compact` (the footer bar) sets the label beside the select as an icon,
 * keeping its text for screen readers.
 */
export function LandingLanguageSelect({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const prefs = useLandingPrefs();
  const copy = useLandingCopy().home.prefs;
  const id = useId();
  if (!prefs || !hasLanguageChoice(prefs)) return null;

  return (
    <div
      className={cn(
        "flex",
        compact ? "items-center gap-2" : "flex-col gap-1.5",
        className,
      )}
    >
      <label
        htmlFor={id}
        className="flex items-center gap-1.5 font-medium text-muted-foreground text-xs"
      >
        <Languages aria-hidden className="size-3.5" />
        <span className={cn(compact && "sr-only")}>{copy.language}</span>
      </label>
      <div className="relative">
        <select
          id={id}
          value={prefs.locale}
          onChange={(event) => prefs.setLocale(event.target.value)}
          className={cn(
            "w-full appearance-none rounded-lg border border-input bg-background py-0 pr-8 pl-3 text-foreground",
            compact ? "h-8 min-w-36 text-xs" : "h-9 min-w-44 text-sm",
            FOCUS,
          )}
        >
          {prefs.locales.map((locale) => (
            <option key={locale.code} value={locale.code} lang={locale.code}>
              {locale.nativeName}
            </option>
          ))}
        </select>
        <ChevronDown
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
      </div>
    </div>
  );
}
