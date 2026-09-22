import { type IllustrationProps, IllustrationSvg } from "./illustration";

/** A trail that runs off the map beside a signpost: a page that isn't here. */
export function WanderingPathIllustration(props: IllustrationProps) {
  return (
    <IllustrationSvg {...props}>
      <ellipse className="fill-muted" cx="80" cy="104" rx="62" ry="9" />
      <path
        d="M26 104c30-4 34-18 58-22s34-14 44-34"
        stroke="currentColor"
        strokeDasharray="2 7"
        strokeWidth="3"
      />
      <path d="M50 104V58" stroke="currentColor" strokeWidth="2.5" />
      <path
        className="fill-card stroke-primary"
        d="M32 52h30l6 6-6 6H32a3 3 0 0 1-3-3v-6a3 3 0 0 1 3-3Z"
        strokeWidth="2"
      />
      <path className="stroke-primary" d="M38 58h16" strokeWidth="2" />
      <path
        className="fill-secondary stroke-primary"
        d="M118 30c-1-8 3-14 9-16 2 8-1 14-9 16Z"
        strokeWidth="1.5"
      />
      <circle className="fill-primary" cx="136" cy="44" r="2.5" />
      <circle cx="104" cy="22" fill="currentColor" opacity="0.5" r="2" />
    </IllustrationSvg>
  );
}
