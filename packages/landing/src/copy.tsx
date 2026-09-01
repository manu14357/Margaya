"use client";

import { createContext, type ReactNode, useContext } from "react";
// Type-only: the JSON is never bundled. Each app passes its own (translated)
// `landing` namespace, which has this shape.
import type messages from "../../../i18n/en-US.json";

/** The `landing` namespace of `i18n/en-US.json`. */
export type LandingCopy = (typeof messages)["landing"];

const LandingCopyContext = createContext<LandingCopy | null>(null);

export function LandingCopyProvider({
  copy,
  children,
}: {
  copy: LandingCopy;
  children: ReactNode;
}) {
  return (
    <LandingCopyContext.Provider value={copy}>
      {children}
    </LandingCopyContext.Provider>
  );
}

/** The landing copy. Throws outside a `LandingCopyProvider`. */
export function useLandingCopy(): LandingCopy {
  const copy = useContext(LandingCopyContext);
  if (!copy) {
    throw new Error("useLandingCopy must be used inside LandingCopyProvider");
  }
  return copy;
}

/**
 * Fills `{{name}}` placeholders, i18next style:
 * `fill("Creates in {{column}}", { column: "To do" })`.
 */
export function fill(
  template: string,
  values: Record<string, string | number>,
): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}
