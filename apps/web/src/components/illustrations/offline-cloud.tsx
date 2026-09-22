import { type IllustrationProps, IllustrationSvg } from "./illustration";

/** A cloud with its line cut: the connection dropped. */
export function OfflineCloudIllustration(props: IllustrationProps) {
  return (
    <IllustrationSvg {...props}>
      <ellipse className="fill-muted" cx="80" cy="104" rx="56" ry="8" />
      <path
        className="fill-card"
        d="M50 82h62a18 18 0 0 0 2-36 28 28 0 0 0-53-6 21 21 0 0 0-11 42Z"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M80 82v8m0 6v2"
        stroke="currentColor"
        strokeOpacity="0.5"
        strokeWidth="2"
      />
      {/* The cut: a background-coloured gap under the slash. */}
      <path className="stroke-background" d="M48 28 116 96" strokeWidth="8" />
      <path className="stroke-primary" d="M48 28 116 96" strokeWidth="2.5" />
      <circle cx="132" cy="26" fill="currentColor" opacity="0.5" r="2" />
      <circle className="fill-primary" cx="30" cy="48" r="2.5" />
    </IllustrationSvg>
  );
}
