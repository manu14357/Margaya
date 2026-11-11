"use client";

import { ArrowDown } from "lucide-react";
import type {
  DesktopFile,
  DesktopFileKey,
  download,
} from "@/lib/desktop-release";
import { fill, formatSize, linuxFileKeys } from "@/lib/desktop-system";
import { cn } from "@/lib/utils";
import { CopyValue } from "./copy-value";
import { type LinuxArch, useDesktopPlatform } from "./desktop-platform";
import { PlatformTabs, type PlatformTabsCopy } from "./platform-tabs";

const FOCUS =
  "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background";

type FilesCopy = (typeof download)["files"];
type RowKey = Exclude<
  DesktopFileKey,
  "linuxArmAppImage" | "linuxArmDeb" | "linuxArmRpm"
>;

/** The file type each installer comes as. */
const FORMATS: Record<DesktopFileKey, string> = {
  macArm: ".dmg",
  macIntel: ".dmg",
  windowsExe: ".exe",
  windowsMsi: ".msi",
  linuxAppImage: ".AppImage",
  linuxDeb: ".deb",
  linuxRpm: ".rpm",
  linuxArmAppImage: ".AppImage",
  linuxArmDeb: ".deb",
  linuxArmRpm: ".rpm",
};

/** ARM64 Linux files share the copy of their x86_64 counterpart. */
const COPY_KEY: Record<DesktopFileKey, RowKey> = {
  macArm: "macArm",
  macIntel: "macIntel",
  windowsExe: "windowsExe",
  windowsMsi: "windowsMsi",
  linuxAppImage: "linuxAppImage",
  linuxDeb: "linuxDeb",
  linuxRpm: "linuxRpm",
  linuxArmAppImage: "linuxAppImage",
  linuxArmDeb: "linuxDeb",
  linuxArmRpm: "linuxRpm",
};

const RECOMMENDED = new Set<RowKey>(["windowsExe", "linuxAppImage"]);

function shortHash(hash: string) {
  return `${hash.slice(0, 8)}…${hash.slice(-8)}`;
}

function FileRow({
  fileKey,
  file,
  copy,
}: {
  fileKey: DesktopFileKey;
  file: DesktopFile | undefined;
  copy: FilesCopy;
}) {
  const rowKey = COPY_KEY[fileKey];
  const text = copy[rowKey];
  return (
    <li className="flex flex-col gap-3 border-border border-t px-4 py-4 first:border-t-0 sm:flex-row sm:items-center sm:gap-6 sm:px-5">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
          {text.name}
          <span className="rounded-md border border-border bg-muted px-1.5 py-px font-mono font-normal text-muted-foreground text-xs">
            {FORMATS[fileKey]}
          </span>
          {RECOMMENDED.has(rowKey) ? (
            <span className="rounded-md bg-primary/10 px-1.5 py-px font-medium text-primary text-xs">
              {copy.recommended}
            </span>
          ) : null}
        </p>
        <p className="mt-1 text-pretty text-muted-foreground text-sm leading-snug">
          {text.detail}
        </p>
      </div>
      {file ? (
        <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:flex-nowrap">
          <span className="mr-1 min-w-16 text-muted-foreground text-sm tabular-nums">
            {formatSize(file.size)}
          </span>
          {file.sha256 ? (
            <>
              <code
                title={file.sha256}
                className="hidden font-mono text-muted-foreground text-xs lg:inline"
              >
                {shortHash(file.sha256)}
              </code>
              <CopyValue
                value={file.sha256}
                label={copy.checksum}
                copiedLabel={copy.copied}
                accessibleLabel={fill(copy.copyChecksumFor, {
                  name: file.name,
                })}
              />
            </>
          ) : (
            <span className="text-muted-foreground text-xs">
              {copy.noChecksum}
            </span>
          )}
          <a
            href={file.url}
            aria-label={fill(copy.downloadFile, { name: file.name })}
            className={cn(
              "ml-auto inline-flex h-8 items-center gap-1.5 rounded-md border border-primary bg-primary px-3 font-medium text-primary-foreground text-sm transition-colors hover:bg-primary/90 sm:ml-0",
              FOCUS,
            )}
          >
            <ArrowDown aria-hidden className="size-3.5" />
            {copy.download}
          </a>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm sm:shrink-0">
          {copy.missing}
        </p>
      )}
    </li>
  );
}

function FileList({
  keys,
  files,
  copy,
}: {
  keys: DesktopFileKey[];
  files: DesktopFile[];
  copy: FilesCopy;
}) {
  return (
    <ul className="overflow-hidden rounded-2xl border border-border bg-card">
      {keys.map((key) => (
        <FileRow
          key={key}
          fileKey={key}
          file={files.find((file) => file.key === key)}
          copy={copy}
        />
      ))}
    </ul>
  );
}

function ArchPicker({ copy }: { copy: FilesCopy }) {
  const { linuxArch, setLinuxArch } = useDesktopPlatform();
  const options: { value: LinuxArch; label: string }[] = [
    { value: "x64", label: copy.x64 },
    { value: "arm", label: copy.arm },
  ];
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <span id="linux-arch-label" className="text-muted-foreground text-sm">
        {copy.architecture}
      </span>
      {/* biome-ignore lint/a11y/useSemanticElements: a pair of toggle buttons, not a form field */}
      <div
        role="group"
        aria-labelledby="linux-arch-label"
        className="inline-flex rounded-lg bg-muted p-0.5"
      >
        {options.map((option) => {
          const pressed = option.value === linuxArch;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={pressed}
              onClick={() => setLinuxArch(option.value)}
              className={cn(
                "h-8 rounded-md px-3 font-medium text-sm transition-colors",
                pressed
                  ? "bg-background text-foreground shadow-sm/5 dark:bg-input"
                  : "text-muted-foreground hover:text-foreground",
                FOCUS,
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function LinuxFiles({
  files,
  copy,
}: {
  files: DesktopFile[];
  copy: FilesCopy;
}) {
  const { linuxArch } = useDesktopPlatform();
  const set = linuxFileKeys[linuxArch];
  return (
    <>
      <ArchPicker copy={copy} />
      <FileList
        keys={[set.appImage, set.deb, set.rpm]}
        files={files}
        copy={copy}
      />
    </>
  );
}

/** Every installer of the release, by platform, with size and checksum. */
export function DownloadFiles({
  files,
  copy,
  tabs,
}: {
  files: DesktopFile[];
  copy: FilesCopy;
  tabs: PlatformTabsCopy;
}) {
  return (
    <PlatformTabs
      copy={tabs}
      panels={{
        macos: (
          <FileList keys={["macArm", "macIntel"]} files={files} copy={copy} />
        ),
        windows: (
          <FileList
            keys={["windowsExe", "windowsMsi"]}
            files={files}
            copy={copy}
          />
        ),
        linux: <LinuxFiles files={files} copy={copy} />,
      }}
    />
  );
}
