import manifest from "../public/images/product/manifest.json";

// The product screenshots in press order (each view light, then dark), read
// from the manifest that scripts/press/capture.mjs writes, so the press page
// and the press kit zip never drift from the files on disk.

const ORIGIN = "https://margaya.app";
const DIRECTORY = "/images/product";

export type PressScreenshotAsset = {
  /** Site path of the image, e.g. "/images/product/board-light.png". */
  path: string;
  /** The view's name, e.g. "Board". */
  title: string;
  /** One sentence on what the screen shows. */
  description: string;
  view: string;
  theme: "light" | "dark";
  width: number;
  height: number;
  format: "PNG";
  /** Absolute, permanent download URL. */
  href: string;
};

export const pressScreenshots: PressScreenshotAsset[] =
  manifest.screenshots.map((shot) => {
    const path = `${DIRECTORY}/${shot.file}`;
    return {
      path,
      title: shot.title,
      description: shot.description,
      view: shot.view,
      theme: shot.theme === "dark" ? "dark" : "light",
      width: shot.width,
      height: shot.height,
      format: "PNG",
      href: new URL(path, ORIGIN).toString(),
    };
  });

/** The press kit archive that bundles logos, these screenshots and brand notes. */
export const pressKitAsset = {
  path: "/press/margaya-press-kit.zip",
  href: `${ORIGIN}/press/margaya-press-kit.zip`,
};

/** Raster wordmarks rendered from the SVG logos (4x, transparent). */
export const pressWordmarkPngs = [
  {
    path: "/press/logos/margaya-wordmark-dark.png",
    surface: "light",
    width: 1800,
    height: 416,
    href: `${ORIGIN}/press/logos/margaya-wordmark-dark.png`,
  },
  {
    path: "/press/logos/margaya-wordmark-light.png",
    surface: "dark",
    width: 1800,
    height: 416,
    href: `${ORIGIN}/press/logos/margaya-wordmark-light.png`,
  },
] as const;
