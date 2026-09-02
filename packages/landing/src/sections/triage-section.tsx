"use client";

import { useLandingCopy } from "../copy";
import { LazyMount } from "../lib/lazy-mount";
import { InboxDemo, IntakeDemo } from "../scenes";
import { LandingSection } from "./section";

const KEYS = [
  { keys: ["J", "K"], id: "move" },
  { keys: ["A"], id: "accept" },
  { keys: ["D"], id: "decline" },
  { keys: ["S"], id: "snooze" },
  { keys: ["U"], id: "duplicate" },
  { keys: ["↵"], id: "open" },
] as const;

/**
 * Owner: L3. Intake with J / K / A keyboard triage, and the notification
 * inbox with snooze.
 */
export function TriageSection() {
  const copy = useLandingCopy().home.triage;
  return (
    <LandingSection id="triage" copy={copy}>
      <LazyMount className="aspect-[16/10]">
        <IntakeDemo />
      </LazyMount>
      <div className="mt-14 grid grid-cols-1 items-start gap-10 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <LazyMount className="aspect-[10/7]">
            <InboxDemo />
          </LazyMount>
        </div>
        <div className="lg:col-span-2">
          <h3 className="font-medium text-lg">{copy.keys.title}</h3>
          <p className="mt-2 text-muted-foreground leading-relaxed">
            {copy.keys.description}
          </p>
          <dl className="mt-6 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {KEYS.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-3 px-4 py-2.5"
              >
                <dt className="flex w-14 shrink-0 items-center gap-1">
                  {item.keys.map((key) => (
                    <kbd
                      key={key}
                      className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-muted px-1 font-medium font-sans text-foreground text-xs"
                    >
                      {key}
                    </kbd>
                  ))}
                </dt>
                <dd className="text-sm">{copy.keys[item.id]}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </LandingSection>
  );
}
