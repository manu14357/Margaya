import { CloudSun, Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import useCurrentMinute from "@/hooks/use-current-minute";
import { useLocale } from "@/hooks/use-locale";
import { authClient } from "@/lib/auth-client";

export type DayPeriod = "morning" | "afternoon" | "evening";

/** Morning before 12:00, afternoon before 18:00, evening after. */
export function dayPeriodOf(date: Date): DayPeriod {
  const hour = date.getHours();
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

/** The display name, or the part of the email before "@". */
export function greetingName(
  user: { name?: string | null; email?: string | null } | null | undefined,
): string {
  const name = user?.name?.trim();
  if (name) return name;
  return user?.email?.split("@")[0] ?? "";
}

const PERIOD_ICONS = { morning: Sun, afternoon: CloudSun, evening: Moon };

// Sunrise amber, daylight blue, dusk violet: area hues reused for the sky.
const PERIOD_TONES = {
  morning: "var(--area-projects)",
  afternoon: "var(--area-inbox)",
  evening: "var(--area-work)",
};

const PERIOD_KEYS = {
  morning: "home:greeting.morning",
  afternoon: "home:greeting.afternoon",
  evening: "home:greeting.evening",
} as const;

export default function HomeGreeting() {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const { data: session } = authClient.useSession();
  const now = useCurrentMinute();
  const period = dayPeriodOf(now);
  const Icon = PERIOD_ICONS[period];

  const date = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(now);
  const time = new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
  }).format(now);

  return (
    <div
      className="relative flex min-w-0 items-center gap-3 overflow-hidden rounded-2xl border px-4 py-4 sm:px-5"
      style={{
        backgroundImage:
          "linear-gradient(120deg, color-mix(in srgb, var(--area-home) 6%, var(--card)) 0%, var(--card) 55%, color-mix(in srgb, var(--area-work) 4%, var(--card)) 100%)",
      }}
    >
      <span
        aria-hidden
        className="flex size-10 shrink-0 items-center justify-center rounded-xl shadow-xs"
        style={{
          backgroundColor: `color-mix(in srgb, ${PERIOD_TONES[period]} 18%, var(--card))`,
          color: PERIOD_TONES[period],
        }}
      >
        <Icon className="size-5" />
      </span>
      <div className="min-w-0 space-y-0.5">
        <h1 className="truncate font-semibold text-xl leading-7">
          {t(PERIOD_KEYS[period], { name: greetingName(session?.user) })}
        </h1>
        <p className="truncate text-[13px] text-muted-foreground">
          {t("home:greeting.dateTime", { date, time })}
        </p>
      </div>
    </div>
  );
}
