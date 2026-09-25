import { useEffect, useState } from "react";

type PageTitleProps = {
  title: string;
  suffix?: string;
  hideAppName?: boolean;
};

// Layouts and pages both render a PageTitle (the dashboard layout's is the
// fallback). Parent effects run after their children's, and re-run when
// their props change, so a plain `document.title =` let the layout overwrite
// the page. Instead every mounted title registers, and the one rendered last
// (the deepest: React renders parents first) wins.
const mounted = new Map<number, string>();
let renderOrder = 0;

function applyTitle() {
  let winner: number | undefined;
  for (const order of mounted.keys()) {
    if (winner === undefined || order > winner) winner = order;
  }
  if (winner !== undefined) {
    document.title = mounted.get(winner) ?? document.title;
  }
}

export default function PageTitle({
  title,
  suffix = "Margaya",
  hideAppName = false,
}: PageTitleProps) {
  const [order] = useState(() => {
    renderOrder += 1;
    return renderOrder;
  });
  const formattedTitle = hideAppName
    ? title
    : suffix
      ? `${title} · ${suffix}`
      : title;

  useEffect(() => {
    mounted.set(order, formattedTitle);
    applyTitle();
    return () => {
      mounted.delete(order);
      applyTitle();
    };
  }, [order, formattedTitle]);

  return null;
}
