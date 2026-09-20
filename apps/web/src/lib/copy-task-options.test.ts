import { describe, expect, it } from "vitest";
import {
  COPY_OPTIONS,
  type CopySourceData,
  copyInclude,
  DEFAULT_COPY_CHOICES,
  visibleCopyOptions,
} from "./copy-task-options";

const everything = Object.fromEntries(
  COPY_OPTIONS.map((option) => [option, true]),
) as CopySourceData;

describe("visibleCopyOptions", () => {
  it("lists every option with data inside the same project", () => {
    expect(visibleCopyOptions(everything, true)).toEqual([...COPY_OPTIONS]);
  });

  it("hides custom fields, parent and planning across projects", () => {
    expect(visibleCopyOptions(everything, false)).toEqual([
      "description",
      "assignees",
      "labels",
      "dates",
      "links",
      "attachments",
    ]);
  });

  it("hides options the source has no data for", () => {
    const visible = visibleCopyOptions(
      { ...everything, labels: false, attachments: false },
      true,
    );
    expect(visible).not.toContain("labels");
    expect(visible).not.toContain("attachments");
    expect(visible).toContain("links");
  });
});

describe("copyInclude", () => {
  it("sends the listed options that are checked", () => {
    const visible = visibleCopyOptions(everything, true);
    expect(copyInclude(visible, DEFAULT_COPY_CHOICES)).toEqual([
      "description",
      "assignees",
      "labels",
      "dates",
      "customFields",
      "parent",
      "planning",
    ]);
    expect(
      copyInclude(["description", "links"], {
        ...DEFAULT_COPY_CHOICES,
        description: false,
        links: true,
      }),
    ).toEqual(["links"]);
  });
});
