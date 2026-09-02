"use client";

import {
  Container,
  Database,
  FileDown,
  History,
  type LucideIcon,
  Scale,
  Ship,
  Trash2,
} from "lucide-react";
import { useLandingCopy } from "../copy";
import { LandingButton } from "../lib/button";
import { useLandingLinks } from "../links";
import { LandingSection } from "./section";

type ItemKey =
  | "docker"
  | "helm"
  | "redis"
  | "trash"
  | "audit"
  | "license"
  | "data";

const ITEMS: { key: ItemKey; icon: LucideIcon }[] = [
  { key: "docker", icon: Container },
  { key: "helm", icon: Ship },
  { key: "redis", icon: Database },
  { key: "trash", icon: Trash2 },
  { key: "audit", icon: History },
  { key: "license", icon: Scale },
  { key: "data", icon: FileDown },
];

// The documented Docker Compose quick start: services `postgres` and
// `margaya`, the web app on port 5173 (apps/docs/core/installation).
const TERMINAL = [
  { prompt: true, text: "docker compose up -d" },
  { prompt: false, text: "✔ postgres  Started" },
  { prompt: false, text: "✔ margaya   Started" },
];

/** Docker, Helm, optional Redis, trash, audit log, MIT licence, your data. */
export function OwnItSection() {
  const copy = useLandingCopy().home.ownIt;
  const links = useLandingLinks();

  return (
    <LandingSection id="own-it" copy={copy}>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-12">
        <div className="flex flex-col items-start gap-6">
          <figure className="w-full overflow-hidden rounded-xl border border-border bg-card shadow-xs">
            <div className="flex items-center gap-1.5 border-border border-b bg-sidebar px-3 py-2">
              <span aria-hidden className="size-2.5 rounded-full bg-border" />
              <span aria-hidden className="size-2.5 rounded-full bg-border" />
              <span aria-hidden className="size-2.5 rounded-full bg-border" />
              <figcaption className="ms-2 truncate text-muted-foreground text-xs">
                {copy.terminalLabel}
              </figcaption>
            </div>
            <pre className="overflow-x-auto p-4 font-mono text-[13px] leading-6">
              <code>
                {TERMINAL.map((line) => (
                  <span
                    key={line.text}
                    className={
                      line.prompt
                        ? "block text-foreground"
                        : "block text-muted-foreground"
                    }
                  >
                    {line.prompt && (
                      <span
                        aria-hidden
                        className="select-none text-muted-foreground"
                      >
                        ${" "}
                      </span>
                    )}
                    {line.text}
                  </span>
                ))}
                <span className="block text-success-foreground">
                  {copy.terminalReady}: http://localhost:5173
                </span>
              </code>
            </pre>
          </figure>
          <LandingButton href={links.selfHost} variant="outline" size="md">
            {copy.cta}
          </LandingButton>
        </div>
        <ul className="grid gap-px self-start overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2">
          {ITEMS.map(({ key, icon: Icon }) => (
            <li key={key} className="bg-background p-5 sm:last:col-span-2">
              <Icon aria-hidden className="size-4 text-muted-foreground" />
              <h3 className="mt-3 font-medium text-foreground text-sm">
                {copy.items[key].title}
              </h3>
              <p className="mt-1.5 text-muted-foreground text-sm leading-relaxed">
                {copy.items[key].body}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </LandingSection>
  );
}
