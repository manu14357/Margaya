import { Play } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import {
  SettingsGroup,
  SettingsRow,
  SettingsSection,
} from "@/components/settings-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { desktopPlaysNotificationSound } from "@/lib/desktop";
import { previewSound } from "@/lib/notification-sound/player";
import {
  isNotificationSound,
  NOTIFICATION_SOUNDS,
  type NotificationSoundId,
  normalizeNotificationSound,
  SOUND_CATEGORIES,
  type SoundCategory,
} from "@/lib/notification-sound/settings";
import { toast } from "@/lib/toast";
import { useNotificationSoundDevice } from "@/store/notification-sound-device";
import { useUserPreferencesStore } from "@/store/user-preferences";

type Translate = ReturnType<typeof useTranslation>["t"];

function soundLabel(t: Translate, sound: NotificationSoundId): string {
  switch (sound) {
    case "none":
      return t("settings:notificationsPage.sound.soundNone");
    case "chime":
      return t("settings:notificationsPage.sound.soundChime");
    case "pop":
      return t("settings:notificationsPage.sound.soundPop");
    case "ding":
      return t("settings:notificationsPage.sound.soundDing");
    case "bell":
      return t("settings:notificationsPage.sound.soundBell");
    case "knock":
      return t("settings:notificationsPage.sound.soundKnock");
    case "marimba":
      return t("settings:notificationsPage.sound.soundMarimba");
  }
}

function categoryText(
  t: Translate,
  category: SoundCategory,
): { label: string; description: string } {
  switch (category) {
    case "mentions":
      return {
        label: t("settings:notificationsPage.sound.categoryMentions"),
        description: t(
          "settings:notificationsPage.sound.categoryMentionsDescription",
        ),
      };
    case "agents":
      return {
        label: t("settings:notificationsPage.sound.categoryAgents"),
        description: t(
          "settings:notificationsPage.sound.categoryAgentsDescription",
        ),
      };
    case "replies":
      return {
        label: t("settings:notificationsPage.sound.categoryReplies"),
        description: t(
          "settings:notificationsPage.sound.categoryRepliesDescription",
        ),
      };
    case "other":
      return {
        label: t("settings:notificationsPage.sound.categoryOther"),
        description: t(
          "settings:notificationsPage.sound.categoryOtherDescription",
        ),
      };
  }
}

/**
 * Sounds for in-app notifications: on or off, volume, a sound per kind of
 * notification, quiet hours (synced with the account) and a mute for this
 * device only.
 */
export function NotificationSoundSettings() {
  const { t } = useTranslation();
  const ids = {
    enabled: useId(),
    volume: useId(),
    quiet: useId(),
    quietStart: useId(),
    quietEnd: useId(),
    device: useId(),
  };
  const stored = useUserPreferencesStore((state) => state.notificationSound);
  const setSound = useUserPreferencesStore(
    (state) => state.setNotificationSound,
  );
  const muted = useNotificationSoundDevice((state) => state.muted);
  const setMuted = useNotificationSoundDevice((state) => state.setMuted);
  const settings = normalizeNotificationSound(stored);
  const off = !settings.enabled;

  async function preview(sound: NotificationSoundId) {
    if (sound === "none") return;
    const played = await previewSound(sound, settings.volume || 50);
    if (!played)
      toast.error(t("settings:notificationsPage.sound.previewFailed"));
  }

  return (
    <SettingsSection
      title={t("settings:notificationsPage.sound.title")}
      description={
        desktopPlaysNotificationSound()
          ? t("settings:notificationsPage.sound.desktopDescription")
          : t("settings:notificationsPage.sound.description")
      }
    >
      <SettingsGroup>
        <SettingsRow
          label={t("settings:notificationsPage.sound.enabled")}
          description={t("settings:notificationsPage.sound.enabledDescription")}
          htmlFor={ids.enabled}
        >
          <Switch
            id={ids.enabled}
            checked={settings.enabled}
            onCheckedChange={(enabled) => setSound({ enabled })}
          />
        </SettingsRow>

        <SettingsRow
          label={t("settings:notificationsPage.sound.volume")}
          htmlFor={ids.volume}
        >
          <div className="flex w-full items-center gap-3 sm:w-56">
            <Slider
              id={ids.volume}
              aria-label={t("settings:notificationsPage.sound.volume")}
              min={0}
              max={100}
              step={5}
              value={settings.volume}
              disabled={off}
              onValueChange={(value) => {
                const volume = Array.isArray(value) ? value[0] : value;
                if (typeof volume === "number") setSound({ volume });
              }}
            />
            <span className="w-10 text-end text-muted-foreground text-xs tabular-nums">
              {t("settings:notificationsPage.sound.volumeValue", {
                value: settings.volume,
              })}
            </span>
          </div>
        </SettingsRow>

        {SOUND_CATEGORIES.map((category) => {
          const { label, description } = categoryText(t, category);
          const sound = settings[category];
          return (
            <SettingsRow key={category} label={label} description={description}>
              <div className="flex items-center gap-1.5">
                <Select
                  value={sound}
                  disabled={off}
                  onValueChange={(value) => {
                    if (!isNotificationSound(value)) return;
                    setSound({ [category]: value });
                    void preview(value);
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    className="w-full sm:w-36"
                    aria-label={label}
                  >
                    <SelectValue>{soundLabel(t, sound)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {NOTIFICATION_SOUNDS.map((value) => (
                      <SelectItem key={value} value={value}>
                        {soundLabel(t, value)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={off || sound === "none"}
                  aria-label={t("settings:notificationsPage.sound.preview", {
                    sound: soundLabel(t, sound),
                  })}
                  onClick={() => void preview(sound)}
                >
                  <Play aria-hidden="true" />
                </Button>
              </div>
            </SettingsRow>
          );
        })}

        <SettingsRow
          label={t("settings:notificationsPage.sound.quietHours")}
          description={t(
            "settings:notificationsPage.sound.quietHoursDescription",
          )}
          htmlFor={ids.quiet}
        >
          <Switch
            id={ids.quiet}
            checked={settings.quietHours}
            disabled={off}
            onCheckedChange={(quietHours) => setSound({ quietHours })}
          />
        </SettingsRow>
        {settings.quietHours && (
          <div className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="flex items-center gap-2">
              <Label htmlFor={ids.quietStart}>
                {t("settings:notificationsPage.sound.quietFrom")}
              </Label>
              <Input
                id={ids.quietStart}
                type="time"
                size="sm"
                className="w-32"
                value={settings.quietStart}
                disabled={off}
                onChange={(event) => {
                  if (event.target.value) {
                    setSound({ quietStart: event.target.value });
                  }
                }}
              />
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor={ids.quietEnd}>
                {t("settings:notificationsPage.sound.quietTo")}
              </Label>
              <Input
                id={ids.quietEnd}
                type="time"
                size="sm"
                className="w-32"
                value={settings.quietEnd}
                disabled={off}
                onChange={(event) => {
                  if (event.target.value) {
                    setSound({ quietEnd: event.target.value });
                  }
                }}
              />
            </div>
          </div>
        )}

        <SettingsRow
          label={t("settings:notificationsPage.sound.deviceMute")}
          description={
            desktopPlaysNotificationSound()
              ? t(
                  "settings:notificationsPage.sound.deviceMuteDescriptionDesktop",
                )
              : t("settings:notificationsPage.sound.deviceMuteDescription")
          }
          htmlFor={ids.device}
        >
          <Switch
            id={ids.device}
            checked={muted}
            onCheckedChange={(checked) => setMuted(checked)}
          />
        </SettingsRow>
      </SettingsGroup>
    </SettingsSection>
  );
}
