import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

// "Mute sounds on this device": deliberately not synced, so one machine
// (a laptop in meetings) can stay quiet while the others play.
type NotificationSoundDeviceStore = {
  muted: boolean;
  setMuted: (muted: boolean) => void;
};

export const useNotificationSoundDevice =
  create<NotificationSoundDeviceStore>()(
    persist(
      (set) => ({
        muted: false,
        setMuted: (muted) => set({ muted }),
      }),
      {
        name: "notification-sound-device",
        storage: createJSONStorage(() => localStorage),
      },
    ),
  );
