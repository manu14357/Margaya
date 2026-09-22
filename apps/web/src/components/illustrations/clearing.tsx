import { type IllustrationProps, IllustrationSvg } from "./illustration";

/** A sprout in an open clearing: a first run, or space ready for work. */
export function ClearingIllustration(props: IllustrationProps) {
  return (
    <IllustrationSvg {...props}>
      <ellipse className="fill-muted" cx="80" cy="104" rx="62" ry="9" />
      <path
        d="M34 104c4-22 14-36 30-42M126 104c-3-18-12-30-26-36"
        stroke="currentColor"
        strokeOpacity="0.5"
        strokeWidth="2"
      />
      <path
        className="fill-card"
        d="M64 62c-10-4-18-14-18-26 12 0 20 8 22 20M100 68c6-10 18-16 30-14-2 12-12 20-26 20"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path className="stroke-primary" d="M80 104V52" strokeWidth="2" />
      <path
        className="fill-secondary stroke-primary"
        d="M80 52c-8-6-10-16-6-26 8 4 11 14 6 26ZM80 76c6-6 14-8 22-6-4 8-12 10-22 6Z"
        strokeWidth="2"
      />
      <circle className="fill-primary" cx="52" cy="22" r="3" />
      <circle cx="118" cy="30" fill="currentColor" opacity="0.5" r="2" />
      <circle cx="132" cy="44" fill="currentColor" opacity="0.5" r="1.5" />
    </IllustrationSvg>
  );
}
