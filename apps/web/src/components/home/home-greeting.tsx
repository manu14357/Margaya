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
    <div className="min-w-0 space-y-0.5">
      <h1 className="truncate font-semibold text-xl leading-7">
        {t(PERIOD_KEYS[period], { name: greetingName(session?.user) })}
      </h1>
      <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
        <Icon className="size-3.5" aria-hidden="true" />
        <span>{t("home:greeting.dateTime", { date, time })}</span>
      </p>
    </div>
  );
}
