import { useEffect, useState } from "react";
import { formatElapsed } from "@/lib/time-entry/duration";

/**
 * A running timer's reading, ticking once a second. Its own component so only
 * this text re-renders.
 */
export default function ElapsedTime({
  startTime,
  className,
}: {
  startTime: string;
  className?: string;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <span className={className}>
      {formatElapsed((now - Date.parse(startTime)) / 1000)}
    </span>
  );
}
