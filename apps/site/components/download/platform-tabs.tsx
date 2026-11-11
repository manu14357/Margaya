"use client";

import type { ReactNode } from "react";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  type Platform,
  platforms,
  useDesktopPlatform,
} from "./desktop-platform";

export type PlatformTabsCopy = Record<Platform, string> & {
  label: string;
  detected: string;
};

/**
 * macOS, Windows and Linux tabs that follow the platform picked anywhere on
 * the page, starting with the visitor's own. Every panel stays in the HTML,
 * so the page reads fully before JavaScript loads.
 */
export function PlatformTabs({
  copy,
  panels,
  className,
}: {
  copy: PlatformTabsCopy;
  panels: Record<Platform, ReactNode>;
  className?: string;
}) {
  const { platform, setPlatform, detected } = useDesktopPlatform();
  return (
    <Tabs
      value={platform}
      onValueChange={(value) => setPlatform(value as Platform)}
      className={cn("gap-0", className)}
    >
      <TabsList
        aria-label={copy.label}
        className="w-full sm:w-fit"
        activateOnFocus
      >
        {platforms.map((value) => (
          <TabsTab key={value} value={value} className="px-4 sm:min-w-28">
            {copy[value]}
            {detected === value ? (
              <>
                <span
                  aria-hidden
                  title={copy.detected}
                  className="size-1.5 rounded-full bg-primary"
                />
                <span className="sr-only">{` (${copy.detected})`}</span>
              </>
            ) : null}
          </TabsTab>
        ))}
      </TabsList>
      {platforms.map((value) => (
        <TabsPanel key={value} value={value} keepMounted className="mt-5">
          {panels[value]}
        </TabsPanel>
      ))}
    </Tabs>
  );
}
