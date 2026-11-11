import {
  desktopPlaysNotificationSound,
  notifyDesktopSoundMuted,
} from "@/lib/desktop";
import { useNotificationSoundDevice } from "@/store/notification-sound-device";
import { useUserPreferencesStore } from "@/store/user-preferences";
import { audioReady, isVoiceActive, playSound } from "./player";
import {
  minutesInZone,
  type NotificationHint,
  normalizeNotificationSound,
  soundFor,
} from "./settings";

/** One sound per burst: later notifications in this window stay silent. */
export const SOUND_WINDOW_MS = 4000;

const LOCK_NAME = "margaya-notification-sound";
const LAST_PLAYED_KEY = "margaya.notification-sound.last";

/**
 * Claims the right to play for the next SOUND_WINDOW_MS, across every open
 * tab: the first tab to ask wins, the others and later asks get false. Web
 * Locks hold the claim; without them a shared timestamp does.
 */
export async function claimSoundSlot(now = Date.now()): Promise<boolean> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (locks?.request) {
    let granted = false;
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await new Promise<void>((answered) => {
      void locks
        .request(LOCK_NAME, { ifAvailable: true }, (lock) => {
          granted = lock !== null;
          answered();
          if (!lock) return;
          setTimeout(release, SOUND_WINDOW_MS);
          return held;
        })
        .catch(() => answered());
    });
    return granted;
  }
  try {
    const last = Number(localStorage.getItem(LAST_PLAYED_KEY) ?? 0);
    if (now - last < SOUND_WINDOW_MS && now >= last) return false;
    localStorage.setItem(LAST_PLAYED_KEY, String(now));
    return true;
  } catch {
    return true;
  }
}

/**
 * Plays the sound a new notification calls for, if any: the user's
 * choices, quiet hours, this device's mute, voice mode and the one-per-burst
 * rule all have a say. Tabs where audio has not started never claim the
 * slot, so a tab that can play gets it.
 */
export async function playForNotification(
  hint: NotificationHint,
  now = new Date(),
): Promise<boolean> {
  // In the desktop app the native notification makes the one sound.
  if (desktopPlaysNotificationSound()) return false;
  if (useNotificationSoundDevice.getState().muted || isVoiceActive()) {
    return false;
  }
  if (!audioReady()) return false;
  const { notificationSound, timeZone } = useUserPreferencesStore.getState();
  const settings = normalizeNotificationSound(notificationSound);
  const sound = soundFor(settings, hint, minutesInZone(now, timeZone));
  if (!sound) return false;
  if (!(await claimSoundSlot(now.getTime()))) return false;
  return playSound(sound, settings.volume);
}

/**
 * In the desktop app, keeps its native notifications as quiet as this
 * device's mute: sends the setting now and on every change. Returns the
 * unsubscribe.
 */
export function syncDesktopSoundMute(): () => void {
  if (!desktopPlaysNotificationSound()) return () => {};
  notifyDesktopSoundMuted(useNotificationSoundDevice.getState().muted);
  return useNotificationSoundDevice.subscribe((state, previous) => {
    if (state.muted !== previous.muted) notifyDesktopSoundMuted(state.muted);
  });
}
