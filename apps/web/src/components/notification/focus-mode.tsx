import { useNavigate } from "@tanstack/react-router";
import { BellOff, BellRing, Moon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { create } from "zustand";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import { normalizeNotificationSound } from "@/lib/notification-sound/settings";
import {
  clampFocusEnd,
  FOCUS_PRESETS,
  type FocusPreset,
  focusEnd,
  type QuietStatus,
  quietStatus,
} from "@/lib/quiet-time";
import { toast } from "@/lib/toast";
import { useUserPreferencesStore } from "@/store/user-preferences";

type Translate = ReturnType<typeof useTranslation>["t"];

export function focusPresetLabel(t: Translate, preset: FocusPreset): string {
  switch (preset) {
    case "30m":
      return t("navigation:focus.preset30m");
    case "1h":
      return t("navigation:focus.preset1h");
    case "2h":
      return t("navigation:focus.preset2h");
    case "tomorrow":
      return t("navigation:focus.presetTomorrow");
  }
}

/** "15:30" today, "Fri 09:00" on another day, in the account time zone. */
export function formatUntil(
  until: Date,
  now: Date,
  timeZone: string | null,
): string {
  const zone = timeZone ?? undefined;
  // The page's language (set by the i18n provider), else the browser's.
  const locale =
    (typeof document !== "undefined" && document.documentElement.lang) ||
    undefined;
  const formatDate = (date: Date, options: Intl.DateTimeFormatOptions) => {
    try {
      return new Intl.DateTimeFormat(locale, options).format(date);
    } catch {
      return new Intl.DateTimeFormat(locale, {
        ...options,
        timeZone: undefined,
      }).format(date);
    }
  };
  const day = (date: Date) =>
    formatDate(date, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: zone,
    });
  const sameDay = day(until) === day(now);
  return formatDate(
    until,
    sameDay
      ? { hour: "2-digit", minute: "2-digit", timeZone: zone }
      : {
          weekday: "short",
          hour: "2-digit",
          minute: "2-digit",
          timeZone: zone,
        },
  );
}

/** Opens the "until a time" dialog from a menu or the command palette. */
export const useFocusDialog = create<{
  open: boolean;
  setOpen: (open: boolean) => void;
}>((set) => ({ open: false, setOpen: (open) => set({ open }) }));

/**
 * Focus mode and quiet hours as the user sees them now, and the actions.
 * The state re-checks every 30 seconds, so a session that ends clears
 * itself. Changes sync to the server (and the user's other devices)
 * through the preferences store.
 */
export function useFocusMode() {
  const { t } = useTranslation();
  const focusUntil = useUserPreferencesStore((state) => state.focusUntil);
  const setFocusUntil = useUserPreferencesStore((state) => state.setFocusUntil);
  const stored = useUserPreferencesStore((state) => state.notificationSound);
  const timeZone = useUserPreferencesStore((state) => state.timeZone);
  const [now, setNow] = useState(() => new Date());
  const sound = normalizeNotificationSound(stored);
  const status: QuietStatus = quietStatus(
    {
      focusUntil,
      quietHours: sound.quietHours,
      quietStart: sound.quietStart,
      quietEnd: sound.quietEnd,
    },
    now,
    timeZone,
  );
  const active = status !== null;

  useEffect(() => {
    // Re-render now when focus starts or ends here or on another device.
    setNow(new Date());
    if (!active && !focusUntil) return;
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, [active, focusUntil]);

  function startUntil(end: Date) {
    const at = new Date();
    const until = clampFocusEnd(end, at);
    if (!until) return;
    setFocusUntil(until.toISOString());
    setNow(at);
    toast.success(
      t("navigation:focus.toastStarted", {
        time: formatUntil(until, at, timeZone),
      }),
    );
  }

  return {
    status,
    now,
    timeZone,
    focusing: status?.kind === "focus",
    start: (preset: FocusPreset) =>
      startUntil(
        focusEnd(
          preset,
          new Date(),
          timeZone,
          sound.quietHours ? sound.quietEnd : null,
        ),
      ),
    startUntil,
    end: () => {
      setFocusUntil(null);
      setNow(new Date());
      toast.success(t("navigation:focus.toastResumed"));
    },
  };
}

/** The "Pause notifications" submenu of the avatar menu. */
export function FocusSubmenu() {
  const { t } = useTranslation();
  const { focusing, status, now, timeZone, start, end } = useFocusMode();
  const openCustom = useFocusDialog((state) => state.setOpen);
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        {status ? <BellOff /> : <Moon />}
        <span className="flex-1">{t("navigation:focus.menuLabel")}</span>
        {status && (
          <span className="text-muted-foreground text-xs">
            {formatUntil(status.until, now, timeZone)}
          </span>
        )}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-56">
        {focusing && (
          <>
            <DropdownMenuItem onClick={end}>
              <BellRing />
              {t("navigation:focus.resume")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {FOCUS_PRESETS.map((preset) => (
          <DropdownMenuItem key={preset} onClick={() => start(preset)}>
            {focusPresetLabel(t, preset)}
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem onClick={() => openCustom(true)}>
          {t("navigation:focus.custom")}
        </DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/**
 * The top bar's sign that notifications are paused, with how long. Shown
 * only while focus mode or quiet hours are on; its menu resumes or extends.
 */
export function FocusStatusButton({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { focusing, status, now, timeZone, start, end } = useFocusMode();
  const openCustom = useFocusDialog((state) => state.setOpen);
  if (!status) return null;
  const time = formatUntil(status.until, now, timeZone);
  const label = focusing
    ? t("navigation:focus.focusUntil", { time })
    : t("navigation:focus.quietUntil", { time });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size={compact ? "icon-sm" : "sm"}
            aria-label={label}
            title={compact ? label : undefined}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            data-slot="focus-status"
          >
            <BellOff aria-hidden />
            {!compact && <span className="truncate">{label}</span>}
          </Button>
        }
      />
      <DropdownMenuContent align="end" sideOffset={8} className="w-60">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        {focusing ? (
          <DropdownMenuItem onClick={end}>
            <BellRing />
            {t("navigation:focus.resume")}
          </DropdownMenuItem>
        ) : (
          FOCUS_PRESETS.map((preset) => (
            <DropdownMenuItem key={preset} onClick={() => start(preset)}>
              {focusPresetLabel(t, preset)}
            </DropdownMenuItem>
          ))
        )}
        {focusing && (
          <DropdownMenuItem onClick={() => openCustom(true)}>
            {t("navigation:focus.custom")}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() =>
            navigate({ to: "/dashboard/settings/account/notifications" })
          }
        >
          {t("navigation:focus.settings")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
