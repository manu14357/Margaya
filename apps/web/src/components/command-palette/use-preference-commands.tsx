import type { AppLocale } from "@i18n/resources";
import { useQuery } from "@tanstack/react-query";
import { BellOff, CalendarDays, Check, Globe, Languages } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  focusPresetLabel,
  formatUntil,
  useFocusDialog,
  useFocusMode,
} from "@/components/notification/focus-mode";
import getUserTimezone from "@/fetchers/user/get-user-timezone";
import useUpdateUserTimezone from "@/hooks/mutations/user/use-update-user-timezone";
import { userTimezoneQueryKey } from "@/hooks/queries/user/use-user-timezone";
import { GUEST_LOCALES } from "@/hooks/use-guest-locale";
import { useLocale } from "@/hooks/use-locale";
import { FOCUS_PRESETS } from "@/lib/quiet-time";
import { browserTimeZone, listTimeZones } from "@/lib/timezones";
import { toast } from "@/lib/toast";
import {
  useUserPreferencesStore,
  WEEK_START_DAYS,
  type WeekStartDay,
} from "@/store/user-preferences";
import type { PaletteActionItem } from "./palette-types";

const ICON = "size-4 opacity-72";

/** A check on the current choice; a spacer keeps the others aligned. */
function current(isCurrent: boolean) {
  return isCurrent ? (
    <Check aria-hidden className={ICON} />
  ) : (
    <span aria-hidden className="size-4 shrink-0" />
  );
}

/**
 * Language, first day of week and time zone, each opening its list inside
 * the palette. The stored time zone is read only while the palette is open.
 */
export function usePreferenceCommands({
  open,
}: {
  open: boolean;
}): PaletteActionItem[] {
  const { t } = useTranslation();
  const { locale, setLocale } = useLocale();
  const weekStartsOn = useUserPreferencesStore((state) => state.weekStartsOn);
  const setWeekStartsOn = useUserPreferencesStore(
    (state) => state.setWeekStartsOn,
  );
  const { data: timezone } = useQuery({
    queryKey: userTimezoneQueryKey,
    queryFn: getUserTimezone,
    enabled: open,
  });
  const { mutateAsync: saveTimezone } = useUpdateUserTimezone();
  const focus = useFocusMode();
  const openFocusDialog = useFocusDialog((state) => state.setOpen);

  return useMemo(() => {
    const languageName =
      GUEST_LOCALES.find((option) => option.code === locale)?.nativeName ??
      locale;
    const weekStartLabels: Record<WeekStartDay, string> = {
      0: t("settings:preferencesPage.weekStartsOnSunday"),
      1: t("settings:preferencesPage.weekStartsOnMonday"),
      6: t("settings:preferencesPage.weekStartsOnSaturday"),
    };
    const zone = timezone?.timezone ?? null;

    const changeLanguage = (code: string) =>
      void setLocale(code as AppLocale).catch((error: unknown) =>
        toast.error(error instanceof Error ? error.message : String(error)),
      );
    const changeTimezone = (next: string) =>
      void saveTimezone(next).then(
        () => toast.success(t("settings:timezone.toastUpdated")),
        (error: unknown) =>
          toast.error(
            error instanceof Error && error.message
              ? error.message
              : t("settings:timezone.toastError"),
          ),
      );

    const focusHint = focus.status
      ? focus.focusing
        ? t("navigation:focus.focusUntil", {
            time: formatUntil(focus.status.until, focus.now, focus.timeZone),
          })
        : t("navigation:focus.quietUntil", {
            time: formatUntil(focus.status.until, focus.now, focus.timeZone),
          })
      : undefined;

    return [
      {
        value: "preference-focus",
        label: t("navigation:focus.paletteLabel"),
        hint: focusHint,
        icon: <BellOff aria-hidden className={ICON} />,
        onRun: () => {},
        submenu: () => ({
          label: t("navigation:focus.paletteLabel"),
          items: [
            ...(focus.focusing
              ? [
                  {
                    value: "focus:resume",
                    label: t("navigation:focus.resume"),
                    onRun: focus.end,
                  },
                ]
              : []),
            ...FOCUS_PRESETS.map((preset) => ({
              value: `focus:${preset}`,
              label: focusPresetLabel(t, preset),
              onRun: () => focus.start(preset),
            })),
            {
              value: "focus:custom",
              label: t("navigation:focus.custom"),
              afterClose: true,
              onRun: () => openFocusDialog(true),
            },
          ],
        }),
      },
      {
        value: "preference-language",
        label: t("settings:preferencesPage.language"),
        hint: languageName,
        icon: <Languages aria-hidden className={ICON} />,
        onRun: () => {},
        submenu: () => ({
          label: t("settings:preferencesPage.language"),
          items: GUEST_LOCALES.map((option) => ({
            value: `language:${option.code}`,
            label: option.nativeName,
            hint: option.code,
            icon: current(option.code === locale),
            onRun: () => changeLanguage(option.code),
          })),
        }),
      },
      {
        value: "preference-week-start",
        label: t("settings:preferencesPage.firstDayOfWeek"),
        hint: weekStartLabels[weekStartsOn],
        icon: <CalendarDays aria-hidden className={ICON} />,
        onRun: () => {},
        submenu: () => ({
          label: t("settings:preferencesPage.firstDayOfWeek"),
          items: WEEK_START_DAYS.map((day) => ({
            value: `week-start:${day}`,
            label: weekStartLabels[day],
            icon: current(day === weekStartsOn),
            onRun: () => setWeekStartsOn(day),
          })),
        }),
      },
      {
        value: "preference-timezone",
        label: t("settings:timezone.accountLabel"),
        hint: zone ?? undefined,
        icon: <Globe aria-hidden className={ICON} />,
        onRun: () => {},
        submenu: () => {
          const detected = browserTimeZone();
          return {
            label: t("settings:timezone.accountLabel"),
            items: [
              {
                value: "timezone:automatic",
                label: t("settings:timezone.automatic", { zone: detected }),
                icon: current(false),
                onRun: () => changeTimezone(detected),
              },
              ...listTimeZones().map((option) => ({
                value: `timezone:${option}`,
                label: option,
                icon: current(option === zone),
                onRun: () => changeTimezone(option),
              })),
            ],
          };
        },
      },
    ];
  }, [
    t,
    locale,
    setLocale,
    weekStartsOn,
    setWeekStartsOn,
    timezone?.timezone,
    saveTimezone,
    focus,
    openFocusDialog,
  ]);
}
