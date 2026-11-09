import { type RefObject, useEffect } from "react";
import { remToPx } from "./timeline";

/**
 * Hides a month's name in a timeline's month row while its band shows only a
 * day or two beside the task list: there is no room for the name there, and
 * it would show as a fragment ("026") at the list's edge. Each name carries
 * `data-gantt-month-label` and sits directly in its band, pinned 0.5rem past
 * the list. Read on scroll, a frame at a time, touching only the month row.
 */
export function useHideClippedMonthLabels(
  scrollerRef: RefObject<HTMLElement | null>,
  {
    timeline,
    rail,
    active = true,
  }: {
    /** The shown days; the row is checked again whenever they change. */
    timeline: unknown;
    /** The task list's width as a rem length, "0rem" when it is hidden. */
    rail: string;
    /** False while the chart itself is not on screen. */
    active?: boolean;
  },
) {
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !timeline || !active) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const edge = scroller.getBoundingClientRect().left + (remToPx(rail) ?? 0);
      const labels = Array.from(
        scroller.querySelectorAll<HTMLElement>("[data-gantt-month-label]"),
      );
      // Every read first, then every write.
      const cut = labels.map((label) => {
        const band = label.parentElement?.getBoundingClientRect();
        // The band's padding on both sides of the pinned name.
        return Boolean(
          band &&
            band.left < edge &&
            band.right - edge < label.offsetWidth + 16,
        );
      });
      labels.forEach((label, index) => {
        label.style.visibility = cut[index] ? "hidden" : "";
      });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    scroller.addEventListener("scroll", schedule, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", schedule);
      cancelAnimationFrame(frame);
    };
  }, [scrollerRef, timeline, rail, active]);
}
