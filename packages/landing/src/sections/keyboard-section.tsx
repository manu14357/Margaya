"use client";

import { Fragment } from "react";
import { type LandingCopy, useLandingCopy } from "../copy";
import { LazyMount } from "../lib/lazy-mount";
import { CommandPaletteDemo } from "../scenes";
import { LandingSection } from "./section";

type KeyboardCopy = LandingCopy["home"]["keyboard"];
type ItemId = keyof KeyboardCopy["items"];

/** "mod" is Ctrl (from copy); `sequence` marks keys pressed one after the other, such as G then H. */
type Shortcut = { id: ItemId; keys: string[]; sequence?: boolean };

/** The app's shortcuts (apps/web constants/shortcuts.ts), grouped. */
const GROUPS: { id: keyof KeyboardCopy["groups"]; shortcuts: Shortcut[] }[] = [
  {
    id: "general",
    shortcuts: [
      { id: "palette", keys: ["mod", "K"] },
      { id: "search", keys: ["/"] },
      { id: "panel", keys: ["mod", "B"] },
      { id: "inbox", keys: ["N", "I"], sequence: true },
      { id: "help", keys: ["?"] },
      { id: "ask", keys: ["mod", "J"] },
    ],
  },
  {
    id: "commandBar",
    shortcuts: [
      { id: "actions", keys: [">"] },
      { id: "tasks", keys: ["#"] },
      { id: "people", keys: ["@"] },
      { id: "places", keys: ["/"] },
    ],
  },
  {
    id: "create",
    shortcuts: [
      { id: "capture", keys: ["C"] },
      { id: "createTask", keys: ["T", "C"], sequence: true },
      { id: "createProject", keys: ["P", "C"], sequence: true },
    ],
  },
  {
    id: "views",
    shortcuts: [
      { id: "board", keys: ["V", "B"], sequence: true },
      { id: "list", keys: ["V", "L"], sequence: true },
      { id: "spreadsheet", keys: ["V", "S"], sequence: true },
      { id: "calendar", keys: ["V", "C"], sequence: true },
      { id: "gantt", keys: ["V", "G"], sequence: true },
    ],
  },
  {
    id: "navigate",
    shortcuts: [
      { id: "next", keys: ["J"] },
      { id: "previous", keys: ["K"] },
      { id: "open", keys: ["Enter"] },
      { id: "select", keys: ["X"] },
      { id: "home", keys: ["G", "H"], sequence: true },
      { id: "myWork", keys: ["G", "Y"], sequence: true },
    ],
  },
  {
    id: "task",
    shortcuts: [
      { id: "status", keys: ["S"] },
      { id: "priority", keys: ["P"] },
      { id: "assignees", keys: ["A"] },
      { id: "labels", keys: ["L"] },
      { id: "dueDate", keys: ["D"] },
      { id: "assignSelf", keys: ["I"] },
    ],
  },
];

/** Owner: L2. The Ctrl K command-bar demo, then the shortcut list. */
export function KeyboardSection() {
  const copy = useLandingCopy().home.keyboard;
  return (
    <LandingSection id="keyboard" copy={copy}>
      <LazyMount className="aspect-[1280/760]">
        <CommandPaletteDemo />
      </LazyMount>
      <section aria-label={copy.shortcutsLabel} className="mt-12">
        <div className="grid gap-x-10 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
          {GROUPS.map((group) => (
            <div key={group.id}>
              <h3 className="font-medium text-foreground text-sm">
                {copy.groups[group.id]}
              </h3>
              <ul className="mt-3 flex flex-col">
                {group.shortcuts.map((shortcut) => (
                  <li
                    key={shortcut.id}
                    className="flex min-h-9 items-center justify-between gap-4 border-border/60 border-b py-1.5 text-sm last:border-b-0"
                  >
                    <span className="min-w-0 text-muted-foreground">
                      {copy.items[shortcut.id]}
                    </span>
                    <ShortcutKeys shortcut={shortcut} copy={copy} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </LandingSection>
  );
}

function ShortcutKeys({
  shortcut,
  copy,
}: {
  shortcut: Shortcut;
  copy: KeyboardCopy;
}) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {shortcut.keys.map((key, index) => (
        <Fragment key={key}>
          {index > 0 && shortcut.sequence && (
            <span className="px-0.5 text-muted-foreground text-xs">
              {copy.then}
            </span>
          )}
          <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded border border-border bg-muted px-1.5 font-medium font-mono text-foreground text-xs">
            {key === "mod" ? copy.modifier : key}
          </kbd>
        </Fragment>
      ))}
    </span>
  );
}
