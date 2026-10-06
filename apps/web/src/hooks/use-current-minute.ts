import { useEffect, useState } from "react";

/**
 * The current time, updated at each minute boundary: a first timer to the
 * next full minute, then one every 60 seconds. Stops on unmount.
 */
export function useCurrentMinute(): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    const current = new Date();
    const untilNextMinute =
      60_000 - (current.getSeconds() * 1000 + current.getMilliseconds());

    const timeout = setTimeout(() => {
      setNow(new Date());
      interval = setInterval(() => setNow(new Date()), 60_000);
    }, untilNextMinute);

    return () => {
      clearTimeout(timeout);
      if (interval !== undefined) clearInterval(interval);
    };
  }, []);

  return now;
}

export default useCurrentMinute;
