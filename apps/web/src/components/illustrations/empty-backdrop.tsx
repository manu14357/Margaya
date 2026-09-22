import { type IllustrationProps, IllustrationSvg } from "./illustration";

/**
 * The small clearing drawn behind an empty state's icon tile, so every
 * `EmptyMedia variant="icon"` reads as an illustration without per-screen art.
 */
export function EmptyBackdrop(props: IllustrationProps) {
  return (
    <IllustrationSvg viewBox="0 0 120 72" {...props}>
      <ellipse className="fill-muted" cx="60" cy="63" rx="52" ry="7" />
      <path
        d="M20 63c2-11 8-19 16-23M100 63c-2-11-8-19-16-23"
        stroke="currentColor"
        strokeOpacity="0.5"
        strokeWidth="1.5"
      />
      <path
        className="fill-card"
        d="M28 45c-8-2-12-8-12-14 8 0 12 6 12 14ZM92 45c8-2 12-8 12-14-8 0-12 6-12 14Z"
        stroke="currentColor"
        strokeOpacity="0.7"
        strokeWidth="1.5"
      />
      <circle cx="14" cy="18" fill="currentColor" opacity="0.4" r="1.75" />
      <circle cx="106" cy="14" fill="currentColor" opacity="0.4" r="1.5" />
      <circle cx="112" cy="26" fill="currentColor" opacity="0.3" r="1" />
    </IllustrationSvg>
  );
}
