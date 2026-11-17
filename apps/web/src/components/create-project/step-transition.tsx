import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

export type StepDirection = "forward" | "back";

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

/**
 * Shared-axis step change: the outgoing step fades and moves 8px against the
 * direction of travel (120ms), the incoming one arrives from 12px (200ms).
 * Under reduced motion only the opacity changes. Forward content arrives from
 * the inline end; the offsets flip in right-to-left documents.
 */
export function StepTransition({
  stepKey,
  direction,
  children,
  onEntered,
  className,
}: {
  stepKey: string;
  direction: StepDirection;
  children: ReactNode;
  /** Runs once the incoming step has settled, e.g. to focus its heading. */
  onEntered?: () => void;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const rtl =
    typeof document !== "undefined" && document.documentElement.dir === "rtl";
  const sign = (direction === "forward" ? 1 : -1) * (rtl ? -1 : 1);
  const variants = {
    initial: { opacity: 0, x: reduceMotion ? 0 : 12 * sign },
    animate: {
      opacity: 1,
      x: 0,
      transition: { duration: reduceMotion ? 0.15 : 0.2, ease: EASE_OUT },
    },
    exit: {
      opacity: 0,
      x: reduceMotion ? 0 : -8 * sign,
      transition: { duration: reduceMotion ? 0.1 : 0.12, ease: EASE_OUT },
    },
  };
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={stepKey}
        className={className}
        variants={variants}
        initial="initial"
        animate="animate"
        exit="exit"
        onAnimationComplete={(definition) => {
          if (definition === "animate") onEntered?.();
        }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
