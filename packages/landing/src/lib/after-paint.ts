"use client";

import { useEffect, useState } from "react";

const raf = (callback: () => void): number =>
  typeof requestAnimationFrame === "function"
    ? requestAnimationFrame(callback)
    : (setTimeout(callback, 16) as unknown as number);

const cancelRaf = (id: number) => {
  if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(id);
  else clearTimeout(id);
};

/**
 * False for the first paint, then true once the browser is idle (or after
 * `timeout` ms). Heavy parts mount behind it so the headline and buttons
 * paint and hydrate first.
 */
export function useAfterPaint(timeout = 300): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let idle = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const frame = raf(() => {
      if (typeof window.requestIdleCallback === "function") {
        idle = window.requestIdleCallback(() => setReady(true), { timeout });
      } else {
        timer = setTimeout(() => setReady(true), 40);
      }
    });
    return () => {
      cancelRaf(frame);
      if (idle && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idle);
      }
      if (timer) clearTimeout(timer);
    };
  }, [timeout]);
  return ready;
}
