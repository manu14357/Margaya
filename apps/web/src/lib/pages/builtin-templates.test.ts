import enUS from "@i18n/en-US.json";
import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";
import { builtinTemplates } from "./builtin-templates";

function lookup(key: string): string {
  const [namespace, path] = key.split(":");
  let node: unknown = (enUS as Record<string, unknown>)[namespace as string];
  for (const part of (path ?? "").split(".")) {
    node = (node as Record<string, unknown> | undefined)?.[part];
  }
  if (typeof node !== "string") throw new Error(`Missing ${key}`);
  return node;
}

const t = ((key: string) => lookup(key)) as unknown as TFunction;

describe("built-in page templates", () => {
  it("offers meeting notes, a spec and a retro with translated names", () => {
    const templates = builtinTemplates(t);
    expect(templates.map((template) => template.id)).toEqual([
      "meeting",
      "spec",
      "retro",
    ]);
    expect(templates.map((template) => template.name)).toEqual([
      "Meeting notes",
      "Spec",
      "Retrospective",
    ]);
  });

  it("builds markdown sections from the translated headings", () => {
    const [meeting] = builtinTemplates(t);
    expect(meeting?.markdown).toBe(
      [
        "## Attendees\n\n-",
        "## Agenda\n\n1.",
        "## Notes",
        "## Decisions\n\n-",
        "## Action items\n\n-",
      ].join("\n\n"),
    );
  });
});
