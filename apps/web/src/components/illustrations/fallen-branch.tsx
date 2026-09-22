import { type IllustrationProps, IllustrationSvg } from "./illustration";

/** A branch on the ground: something broke, nothing is lost. */
export function FallenBranchIllustration(props: IllustrationProps) {
  return (
    <IllustrationSvg {...props}>
      <ellipse className="fill-muted" cx="80" cy="104" rx="64" ry="9" />
      <path
        d="M22 98c30-6 62-8 116-4"
        stroke="currentColor"
        strokeOpacity="0.5"
        strokeWidth="2"
      />
      <path d="M36 92 120 70" stroke="currentColor" strokeWidth="5" />
      <path
        d="m120 70 14-10M96 76l6-14M64 84l-4-14"
        stroke="currentColor"
        strokeWidth="3"
      />
      <path
        className="fill-destructive/8 stroke-destructive"
        d="M134 60c6-6 14-6 18-2-6 6-12 6-18 2Z"
        strokeWidth="1.5"
      />
      <path
        className="fill-secondary stroke-primary"
        d="M102 62c-2-8 2-14 8-16 2 8-2 14-8 16ZM60 70c-6-6-6-14-2-18 6 6 6 12 2 18Z"
        strokeWidth="1.5"
      />
      <path
        d="M70 30c4-6 10-6 14 0M86 22c3-4 7-4 10 0"
        stroke="currentColor"
        strokeOpacity="0.5"
        strokeWidth="2"
      />
    </IllustrationSvg>
  );
}
