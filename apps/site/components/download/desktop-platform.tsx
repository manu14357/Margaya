"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  type DetectedSystem,
  detectSystem,
  isArmLinux,
  isIntelMac,
} from "@/lib/desktop-system";

export type Platform = "macos" | "windows" | "linux";
export type LinuxArch = "x64" | "arm";

export const platforms: Platform[] = ["macos", "windows", "linux"];

type DesktopPlatformState = {
  /** null until the page has hydrated and read the user agent. */
  detected: DetectedSystem | null;
  intelMac: boolean;
  /** The platform shown by the downloads and install tabs. */
  platform: Platform;
  setPlatform: (platform: Platform) => void;
  linuxArch: LinuxArch;
  setLinuxArch: (arch: LinuxArch) => void;
};

const DesktopPlatformContext = createContext<DesktopPlatformState | null>(null);

/**
 * The visitor's system, read once after hydration, and the platform and
 * Linux architecture picked on the page. The download tabs and the install
 * tabs share it, so picking Linux in one shows Linux in the other.
 */
export function DesktopPlatformProvider({ children }: { children: ReactNode }) {
  const [detected, setDetected] = useState<DetectedSystem | null>(null);
  const [intelMac, setIntelMac] = useState(false);
  const [platform, setPlatform] = useState<Platform>("macos");
  const [linuxArch, setLinuxArch] = useState<LinuxArch>("x64");

  useEffect(() => {
    const system = detectSystem(navigator.userAgent, navigator.maxTouchPoints);
    setDetected(system);
    if (system !== "other") setPlatform(system);
    if (system === "linux" && isArmLinux(navigator.userAgent)) {
      setLinuxArch("arm");
    }
    if (system !== "macos") return;
    let active = true;
    void isIntelMac().then((value) => {
      if (active) setIntelMac(value);
    });
    return () => {
      active = false;
    };
  }, []);

  const value = useMemo(
    () => ({
      detected,
      intelMac,
      platform,
      setPlatform,
      linuxArch,
      setLinuxArch,
    }),
    [detected, intelMac, platform, linuxArch],
  );

  return (
    <DesktopPlatformContext.Provider value={value}>
      {children}
    </DesktopPlatformContext.Provider>
  );
}

export function useDesktopPlatform() {
  const state = useContext(DesktopPlatformContext);
  if (!state) {
    throw new Error("useDesktopPlatform needs a DesktopPlatformProvider");
  }
  return state;
}
