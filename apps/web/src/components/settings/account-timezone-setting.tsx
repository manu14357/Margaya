import { useTranslation } from "react-i18next";
import { SettingsRow } from "@/components/settings-layout";
import useUpdateUserTimezone from "@/hooks/mutations/user/use-update-user-timezone";
import useUserTimezone from "@/hooks/queries/user/use-user-timezone";
import { browserTimeZone } from "@/lib/timezones";
import { toast } from "@/lib/toast";
import TimezoneSelect from "./timezone-select";

/**
 * The account time zone for server-rendered times (reminders, digests) and
 * the days task filters and analytics count in. "Automatic" stores the
 * browser's zone when chosen; times on screen stay in the browser's zone.
 */
export default function AccountTimezoneSetting() {
  const { t } = useTranslation();
  const { data, isError } = useUserTimezone();
  const { mutateAsync, isPending } = useUpdateUserTimezone();
  const detected = browserTimeZone();

  const save = async (timezone: string) => {
    try {
      await mutateAsync(timezone);
      toast.success(t("settings:timezone.toastUpdated"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings:timezone.toastError"),
      );
    }
  };

  return (
    <SettingsRow
      label={t("settings:timezone.accountLabel")}
      htmlFor="account-timezone"
      description={
        isError
          ? t("settings:timezone.loadError")
          : t("settings:timezone.accountHint")
      }
    >
      <TimezoneSelect
        id="account-timezone"
        label={t("settings:timezone.accountLabel")}
        value={data?.timezone ?? null}
        onChange={save}
        disabled={isPending || !data}
        leading={{
          label: t("settings:timezone.automatic", { zone: detected }),
          onSelect: () => void save(detected),
        }}
      />
    </SettingsRow>
  );
}
