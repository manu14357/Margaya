"use client";

import { ArrowDown, MonitorSmartphone } from "lucide-react";
import type { DesktopFile, DesktopFileKey } from "@/lib/desktop-release";
import { fill, formatSize, linuxFileKeys } from "@/lib/desktop-system";
import { cn } from "@/lib/utils";
import { useDesktopPlatform } from "./desktop-platform";

const FOCUS =
  "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background";

const TEXT_LINK = cn(
  "rounded-sm font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-current",
  FOCUS,
);

export type DownloadPickerCopy = {
  mac: string;
  windows: string;
  linux: string;
  appleSilicon: string;
  intel: string;
  windowsDetail: string;
  linuxDetail: string;
  linuxArmDetail: string;
  otherMacArm: string;
  otherMacIntel: string;
  unsupported: string;
  otherPlatforms: string;
  version: string;
  released: string;
  releaseNotes: string;
};

function DownloadButton({
  file,
  label,
  detail,
  version,
  primary,
}: {
  file: DesktopFile;
  label: string;
  detail: string;
  version: string;
  primary: boolean;
}) {
  return (
    <a
      href={file.url}
      className={cn(
        "inline-flex min-h-14 items-center gap-3.5 rounded-xl border py-2.5 pr-6 pl-5 text-left transition-colors",
        primary
          ? "border-primary bg-primary text-primary-foreground shadow-sm/10 hover:bg-primary/90"
          : "border-input bg-popover text-foreground shadow-xs/5 hover:bg-accent/50 dark:bg-input/32 dark:hover:bg-input/64",
        FOCUS,
      )}
    >
      <ArrowDown aria-hidden className="size-5 shrink-0" />
      <span className="flex flex-col">
        <span className="font-medium text-base leading-tight">{label}</span>
        <span
          className={cn(
            "mt-0.5 text-xs leading-tight",
            primary ? "text-primary-foreground/75" : "text-muted-foreground",
          )}
        >
          {[version, detail, formatSize(file.size)].join(" · ")}
        </span>
      </span>
    </a>
  );
}

/**
 * One button for the visitor's system, picked after hydration. The static
 * HTML (and a visitor without JavaScript) gets the Mac, Windows and Linux
 * buttons side by side; every file is also listed in the downloads section.
 * On Linux the button is the AppImage, which runs on any distribution and
 * updates itself.
 */
export function DownloadPicker({
  files,
  copy,
  version,
  releasedOn,
  notesUrl,
  allDownloadsHref,
}: {
  files: DesktopFile[];
  copy: DownloadPickerCopy;
  version: string;
  /** The formatted release date, if known. */
  releasedOn: string | null;
  notesUrl: string;
  allDownloadsHref: string;
}) {
  const { detected: system, intelMac, linuxArch } = useDesktopPlatform();

  const byKey = (key: DesktopFileKey) => files.find((f) => f.key === key);
  const macArm = byKey("macArm");
  const macIntel = byKey("macIntel");
  const windows = byKey("windowsExe") ?? byKey("windowsMsi");

  // The visitor's architecture first, else the other one.
  const linuxOther = linuxArch === "arm" ? "x64" : "arm";
  const linuxAppImage =
    byKey(linuxFileKeys[linuxArch].appImage) ??
    byKey(linuxFileKeys[linuxOther].appImage);
  const linuxArm = linuxAppImage?.key === linuxFileKeys.arm.appImage;

  const macPrimary = intelMac ? (macIntel ?? macArm) : (macArm ?? macIntel);
  const macOther = macPrimary === macArm ? macIntel : macArm;
  const macDetail = (file: DesktopFile) =>
    file.key === "macIntel" ? copy.intel : copy.appleSilicon;
  const versionLabel = fill(copy.version, { version });

  const meta = (
    <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-muted-foreground text-sm">
      {releasedOn ? (
        <>
          <span>{fill(copy.released, { date: releasedOn })}</span>
          <span aria-hidden>·</span>
        </>
      ) : null}
      <a href={notesUrl} target="_blank" rel="noreferrer" className={TEXT_LINK}>
        {copy.releaseNotes}
      </a>
      <span aria-hidden>·</span>
      <a href={allDownloadsHref} className={TEXT_LINK}>
        {copy.otherPlatforms}
      </a>
    </p>
  );

  if (system === "other") {
    return (
      <div className="mt-9 flex max-w-xl flex-col items-center gap-4 text-center">
        <p className="flex items-start gap-3 rounded-xl border border-border border-dashed px-4 py-3 text-left text-muted-foreground text-sm leading-relaxed">
          <MonitorSmartphone aria-hidden className="mt-0.5 size-4 shrink-0" />
          {copy.unsupported}
        </p>
        {meta}
      </div>
    );
  }

  const showMac = (system === null || system === "macos") && macPrimary;
  const showWindows = (system === null || system === "windows") && windows;
  const showLinux = (system === null || system === "linux") && linuxAppImage;

  return (
    <div className="mt-9 flex w-full flex-col items-center gap-4">
      <div className="flex w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row sm:items-center">
        {showMac ? (
          <DownloadButton
            file={macPrimary}
            label={copy.mac}
            detail={macDetail(macPrimary)}
            version={versionLabel}
            primary
          />
        ) : null}
        {showWindows ? (
          <DownloadButton
            file={windows}
            label={copy.windows}
            detail={copy.windowsDetail}
            version={versionLabel}
            primary={system === "windows" || !showMac}
          />
        ) : null}
        {showLinux ? (
          <DownloadButton
            file={linuxAppImage}
            label={copy.linux}
            detail={linuxArm ? copy.linuxArmDetail : copy.linuxDetail}
            version={versionLabel}
            primary={system === "linux" || (!showMac && !showWindows)}
          />
        ) : null}
      </div>
      {system === "macos" && macOther ? (
        <a href={macOther.url} className={cn(TEXT_LINK, "text-sm")}>
          {macOther.key === "macIntel" ? copy.otherMacIntel : copy.otherMacArm}
        </a>
      ) : null}
      {meta}
    </div>
  );
}
