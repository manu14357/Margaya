"use client";

import {
  ArrowDown,
  ChevronLeft,
  ChevronRight,
  ImageOff,
  Maximize2,
  X,
} from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { CopyButton } from "@/components/landing/copy-button";
import type { PressScreenshot } from "@/lib/press";
import { cn } from "@/lib/utils";

export type GalleryCopy = {
  empty: string;
  open: string;
  close: string;
  previous: string;
  next: string;
  light: string;
  dark: string;
  size: string;
  counter: string;
  download: string;
  copyUrl: string;
  copied: string;
};

const FOCUS =
  "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background";

const ACTION = cn(
  "inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-popover px-2.5 font-medium text-foreground text-sm shadow-xs/5 transition-colors hover:bg-accent/50 dark:bg-input/32 dark:hover:bg-input/64",
  FOCUS,
);

function fillIn(template: string, values: Record<string, string | number>) {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

function fileName(path: string) {
  return path.split("/").pop() ?? path;
}

/** "PNG", "WEBP"…: the file format, from the extension. */
function formatOf(path: string) {
  return (fileName(path).split(".").pop() ?? "").toUpperCase();
}

function Actions({
  asset,
  copy,
}: {
  asset: PressScreenshot;
  copy: GalleryCopy;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <a
        href={asset.path}
        download={fileName(asset.path)}
        className={ACTION}
        aria-label={`${copy.download}: ${asset.title}`}
      >
        <ArrowDown aria-hidden className="size-3.5" />
        {copy.download}
      </a>
      <CopyButton
        value={asset.href}
        label={copy.copyUrl}
        copiedLabel={copy.copied}
      />
    </div>
  );
}

/**
 * The screenshot grid, and a modal lightbox (a native dialog) that shows one
 * at full size with previous/next buttons and arrow keys.
 */
export function ScreenshotGallery({
  assets,
  copy,
}: {
  assets: PressScreenshot[];
  copy: GalleryCopy;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [index, setIndex] = useState<number | null>(null);
  const current = index === null ? null : assets[index];

  const open = (next: number) => {
    setIndex(next);
    dialogRef.current?.showModal();
  };
  const step = useCallback(
    (delta: number) =>
      setIndex((value) =>
        value === null
          ? value
          : (value + delta + assets.length) % assets.length,
      ),
    [assets.length],
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onClose = () => setIndex(null);
    dialog.addEventListener("close", onClose);
    return () => dialog.removeEventListener("close", onClose);
  }, []);

  if (assets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-border border-dashed bg-muted/30 px-6 py-14 text-center text-muted-foreground text-sm">
        <ImageOff aria-hidden className="size-5" />
        <p className="max-w-md text-balance">{copy.empty}</p>
      </div>
    );
  }

  return (
    <>
      <ul className="grid gap-5 sm:grid-cols-2">
        {assets.map((asset, assetIndex) => (
          <li
            key={asset.path}
            className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card"
          >
            <button
              type="button"
              onClick={() => open(assetIndex)}
              aria-label={fillIn(copy.open, { title: asset.title })}
              className={cn(
                "group relative block overflow-hidden bg-muted/40",
                FOCUS,
              )}
            >
              <Image
                src={asset.path}
                alt=""
                width={asset.width}
                height={asset.height}
                className="h-auto w-full transition-transform duration-300 group-hover:scale-[1.015] motion-reduce:transition-none"
              />
              <span className="absolute top-3 right-3 flex size-8 items-center justify-center rounded-lg border border-border bg-background/90 text-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                <Maximize2 aria-hidden className="size-4" />
              </span>
            </button>
            <div className="flex flex-1 flex-wrap items-center justify-between gap-3 border-border border-t px-4 py-3">
              <div className="min-w-0">
                <p className="font-medium text-sm">{asset.title}</p>
                <p className="mt-0.5 text-muted-foreground text-xs">
                  {asset.theme === "dark" ? copy.dark : copy.light}
                  {" · "}
                  {fillIn(copy.size, {
                    width: asset.width,
                    height: asset.height,
                    format: formatOf(asset.path),
                  })}
                </p>
              </div>
              <Actions asset={asset} copy={copy} />
            </div>
          </li>
        ))}
      </ul>

      <dialog
        ref={dialogRef}
        aria-label={current?.title}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") step(1);
          if (event.key === "ArrowLeft") step(-1);
        }}
        onClick={(event) => {
          // A press on the backdrop (the dialog box itself) closes it.
          if (event.target === event.currentTarget) dialogRef.current?.close();
        }}
        className="m-auto max-h-[100dvh] w-[min(100vw,80rem)] max-w-none bg-transparent p-3 text-foreground backdrop:bg-black/75 backdrop:backdrop-blur-sm md:p-6"
      >
        {current && index !== null && (
          <div className="flex flex-col overflow-hidden rounded-2xl border border-border bg-popover shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-border border-b px-4 py-2.5">
              <p className="min-w-0 truncate font-medium text-sm">
                {current.title}
                <span className="ml-2 font-normal text-muted-foreground text-xs">
                  {fillIn(copy.counter, {
                    current: index + 1,
                    total: assets.length,
                  })}
                </span>
              </p>
              <button
                type="button"
                onClick={() => dialogRef.current?.close()}
                aria-label={copy.close}
                className={cn(
                  "inline-flex size-9 shrink-0 items-center justify-center rounded-md hover:bg-accent",
                  FOCUS,
                )}
              >
                <X aria-hidden className="size-4" />
              </button>
            </div>
            <div className="relative bg-muted/40">
              <Image
                src={current.path}
                alt={current.title}
                width={current.width}
                height={current.height}
                className="mx-auto h-auto max-h-[calc(100dvh-10rem)] w-auto max-w-full object-contain"
              />
              {assets.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => step(-1)}
                    aria-label={copy.previous}
                    className={cn(
                      "absolute top-1/2 left-3 flex size-10 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background/90 shadow-sm hover:bg-background",
                      FOCUS,
                    )}
                  >
                    <ChevronLeft aria-hidden className="size-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => step(1)}
                    aria-label={copy.next}
                    className={cn(
                      "absolute top-1/2 right-3 flex size-10 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background/90 shadow-sm hover:bg-background",
                      FOCUS,
                    )}
                  >
                    <ChevronRight aria-hidden className="size-5" />
                  </button>
                </>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-border border-t px-4 py-2.5">
              <p className="text-muted-foreground text-xs">
                {current.theme === "dark" ? copy.dark : copy.light}
                {" · "}
                {fillIn(copy.size, {
                  width: current.width,
                  height: current.height,
                  format: formatOf(current.path),
                })}
              </p>
              <Actions asset={current} copy={copy} />
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
