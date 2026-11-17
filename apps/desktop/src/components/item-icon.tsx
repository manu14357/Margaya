// Small line icons for search results, drawn inline so the launcher bundle
// needs no icon library. 16 px, currentColor, decorative (aria-hidden).

const PATHS: Record<string, string> = {
  // A checked box.
  task: "M4 3h8a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM5.5 8l2 2 3-4",
  // Three board columns.
  project: "M3 3h10v10H3zM6.5 3v10M9.5 3v10",
  // A page with a folded corner.
  page: "M4 2h5l3 3v9H4zM9 2v3h3M6 8h4M6 10.5h4",
  // A circular arrow.
  cycle: "M13 8a5 5 0 1 1-1.5-3.5M13 2.5V5h-2.5",
  // Stacked boxes.
  module: "M2.5 9h5v4.5h-5zM8.5 9h5v4.5h-5zM5.5 3h5v4.5h-5z",
  // Layers.
  view: "M8 2.5 14 6 8 9.5 2 6zM2 9l6 3.5L14 9",
  // An inbox tray.
  intake: "M2.5 9h3l1 2h3l1-2h3M3.5 3.5h9l1 5.5v4.5h-11V9z",
  // A speech bubble.
  comment: "M3 3.5h10v7H7l-3 2.5v-2.5H3z",
  // A lightning bolt.
  activity: "M9 2 4 9h4l-1 5 5-7H8z",
  // Two people.
  workspace:
    "M6 7.5a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5zM2 13c0-2.2 1.8-3.5 4-3.5s4 1.3 4 3.5M10.5 3.2a2.2 2.2 0 0 1 0 4.1M12 9.7c1.2.4 2 1.6 2 3.3",
  // A dot in a circle, for anything else.
  other: "M8 2.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11zM8 7.25v1.5",
};

export function ItemIcon({ kind }: { kind: string }) {
  const path = PATHS[kind] ?? PATHS.other;
  return (
    <svg
      className="item-icon"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={path} />
    </svg>
  );
}
