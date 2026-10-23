import fs from "node:fs";
import path from "node:path";
import Image from "next/image";
import type { GuideShot } from "@/lib/guides";
import { cn } from "@/lib/utils";
import { ScreenFrame } from "./screen-frame";

const PRODUCT_DIR = path.join(process.cwd(), "public", "images", "product");

/** Width and height from a PNG's IHDR chunk, or null when the file is missing. */
function pngSize(file: string) {
  try {
    const handle = fs.openSync(file, "r");
    const header = Buffer.alloc(24);
    fs.readSync(handle, header, 0, 24, 0);
    fs.closeSync(handle);
    return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
  } catch {
    return null;
  }
}

/**
 * A product screenshot in the visitor's theme. Both images are in the HTML
 * and CSS shows the one that matches, so a theme switch never waits on a
 * request. Renders nothing until the screenshots exist.
 */
export function ProductShot({
  shot,
  className,
}: {
  shot: GuideShot;
  className?: string;
}) {
  const light = pngSize(path.join(PRODUCT_DIR, `${shot.view}-light.png`));
  const dark = pngSize(path.join(PRODUCT_DIR, `${shot.view}-dark.png`));
  if (!light || !dark) return null;

  const image = "block h-auto w-full";

  return (
    <ScreenFrame caption={shot.caption} className={className}>
      <Image
        alt={shot.alt}
        className={cn(image, "dark:hidden")}
        height={light.height}
        src={`/images/product/${shot.view}-light.png`}
        width={light.width}
      />
      <Image
        alt={shot.alt}
        className={cn(image, "hidden dark:block")}
        height={dark.height}
        src={`/images/product/${shot.view}-dark.png`}
        width={dark.width}
      />
    </ScreenFrame>
  );
}
