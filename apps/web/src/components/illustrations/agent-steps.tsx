import { type IllustrationProps, IllustrationSvg } from "./illustration";

/** An agent on a clearing with a trail of steps: pick a run to follow it. */
export function AgentStepsIllustration(props: IllustrationProps) {
  return (
    <IllustrationSvg {...props}>
      <ellipse className="fill-muted" cx="80" cy="104" rx="62" ry="9" />
      <path
        d="M24 96c12-6 22-16 34-22s24-6 32-6"
        stroke="currentColor"
        strokeDasharray="2 7"
        strokeOpacity="0.6"
        strokeWidth="2.5"
      />
      <circle className="fill-primary" cx="40" cy="84" r="3" />
      <circle className="fill-primary" cx="64" cy="71" r="3" />
      <rect
        className="fill-card"
        height="34"
        rx="9"
        stroke="currentColor"
        strokeWidth="2"
        width="44"
        x="92"
        y="40"
      />
      <circle className="fill-primary" cx="107" cy="57" r="2.5" />
      <circle className="fill-primary" cx="121" cy="57" r="2.5" />
      <path d="M114 40v-8" stroke="currentColor" strokeWidth="2" />
      <circle className="fill-primary" cx="114" cy="29" r="3" />
    </IllustrationSvg>
  );
}
