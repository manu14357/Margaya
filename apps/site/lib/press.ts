import messages from "../../../i18n/en-US.json";

// The press page is English-only; its copy is the canonical locale's `press`.
export const press = messages.press;

const ORIGIN = "https://margaya.app";
const REPOSITORY = "https://github.com/manu14357/Margaya";

/** Press assets are linked by their permanent, absolute address. */
export function pressUrl(path: string) {
  return new URL(path, ORIGIN).toString();
}

export const pressKitPath = "/press/margaya-press-kit.zip";

export const pressLinks = {
  kit: pressUrl(pressKitPath),
  discussions: `${REPOSITORY}/discussions`,
  issues: `${REPOSITORY}/issues/new`,
  source: REPOSITORY,
};

/** What the screenshot gallery needs from `lib/press-assets.ts`. */
export type PressScreenshot = {
  /** Site path of the image. */
  path: string;
  title: string;
  theme: "light" | "dark";
  width: number;
  height: number;
  /** Absolute download URL. */
  href: string;
};

type LogoKey = keyof typeof press.logos &
  ("wordmarkDark" | "wordmarkLight" | "iconSvg" | "iconPng");

export const pressLogos: {
  key: LogoKey;
  path: string;
  /** The preview's backdrop: the background the file is made for. */
  surface: "light" | "dark";
  width: number;
  height: number;
}[] = [
  {
    key: "wordmarkDark",
    path: "/logo-dark.svg",
    surface: "light",
    width: 450,
    height: 104,
  },
  {
    key: "wordmarkLight",
    path: "/logo-light.svg",
    surface: "dark",
    width: 450,
    height: 104,
  },
  {
    key: "iconSvg",
    path: "/favicon.svg",
    surface: "light",
    width: 136,
    height: 136,
  },
  {
    key: "iconPng",
    path: "/logo-512.png",
    surface: "dark",
    width: 512,
    height: 512,
  },
];

/** The brand neutrals behind the theme tokens, light to dark. */
export const pressColours: {
  key: "white" | "mist" | "paper" | "graphite" | "ink";
  hex: string;
}[] = [
  { key: "white", hex: "#FFFFFF" },
  { key: "mist", hex: "#FAFAFA" },
  { key: "paper", hex: "#F5F5F5" },
  { key: "graphite", hex: "#262626" },
  { key: "ink", hex: "#141414" },
];

/** "2.8 MB" style sizes for download buttons. */
export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
