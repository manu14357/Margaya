import { describe, expect, it } from "vitest";
import { findTemplate } from "../../../apps/api/src/project-template/catalog";
import {
  featureFields,
  resolveTemplate,
  TemplateTextError,
  textKeysOf,
} from "../../../apps/api/src/project-template/resolve";
import {
  acceptedLanguages,
  createTextSource,
  matchLocale,
  mergeTrees,
  pickLocale,
  templateTextSource,
} from "../../../apps/api/src/project-template/text";
import type { ProjectTemplate } from "../../../apps/api/src/project-template/types";

const tiny: ProjectTemplate = {
  id: "tiny",
  version: 1,
  categories: ["work-management"],
  icon: "Layout",
  name: "projectTemplates:catalog.tiny.name",
  pitch: "projectTemplates:catalog.tiny.pitch",
  description: "projectTemplates:catalog.tiny.description",
  suggestedKey: "TNY",
  project: {
    features: {
      cycles: false,
      modules: false,
      views: false,
      pages: false,
      whiteboards: true,
      intake: false,
      estimates: true,
      timeTracking: false,
      ai: false,
      updates: false,
    },
  },
  columns: [
    {
      key: "todo",
      name: "projectTemplates:content.tiny.todo",
      group: "unstarted",
    },
    {
      key: "done",
      name: "projectTemplates:content.tiny.done",
      group: "completed",
    },
  ],
  customFields: [
    {
      key: "size",
      name: "projectTemplates:content.tiny.size",
      type: "dropdown",
      options: [
        { key: "s", label: "projectTemplates:content.tiny.small" },
        { key: "l", label: "projectTemplates:content.tiny.large" },
      ],
      defaultOption: "l",
      required: true,
    },
  ],
  estimate: {
    name: "projectTemplates:content.tiny.estimate",
    type: "points",
    values: ["5", "1", "2.50"],
  },
  whiteboards: [
    { title: "projectTemplates:content.tiny.board", board: "roadmap" },
  ],
};

const english = {
  catalog: {
    tiny: { name: "Tiny", pitch: "Small", description: "A tiny one" },
  },
  content: {
    tiny: {
      todo: "To do now",
      done: "Done!",
      size: "Size",
      small: "Small",
      large: "Large",
      estimate: "Points",
      board: "Plan",
    },
  },
};

const german = mergeTrees(english, {
  content: { tiny: { todo: "Zu erledigen", large: "Groß" } },
});

const source = createTextSource({
  "en-US": {
    projectTemplates: english,
    whiteboards: {
      templates: {
        labels: {
          roadmap: {
            title: "Roadmap",
            now: "Now",
            next: "Next",
            later: "Later",
          },
        },
      },
    },
  },
  "de-DE": { projectTemplates: german },
});

describe("locale choice", () => {
  it("prefers the request, then the saved locale, then the header", () => {
    expect(
      pickLocale({
        requested: "fr",
        userLocale: "de-DE",
        acceptLanguage: "es",
      }),
    ).toBe("fr-FR");
    expect(pickLocale({ userLocale: "de-AT", acceptLanguage: "es" })).toBe(
      "de-DE",
    );
    expect(pickLocale({ acceptLanguage: "xx, ja;q=0.5, ko;q=0.9" })).toBe(
      "ko-KR",
    );
    expect(pickLocale({ requested: "xx-YY" })).toBe("en-US");
    expect(pickLocale({})).toBe("en-US");
  });

  it("matches by language code and parses quality values", () => {
    expect(matchLocale("pt-PT")).toBe("pt-BR");
    expect(matchLocale("ZH_tw")).toBe("zh-CN");
    expect(matchLocale("")).toBeNull();
    expect(acceptedLanguages("en;q=0.1, *, de;q=0, fr")).toEqual(["fr", "en"]);
  });
});

describe("resolveTemplate", () => {
  it("collects every text key, whiteboard labels included", () => {
    const keys = textKeysOf(tiny);
    expect(keys).toContain("projectTemplates:content.tiny.large");
    expect(keys).toContain("whiteboards:templates.labels.roadmap.now");
  });

  it("resolves text, slugs, options and estimate values", () => {
    const resolved = resolveTemplate(tiny, "de-DE", source);
    expect(resolved.columns.map((column) => column.slug)).toEqual([
      "zu-erledigen",
      "done",
    ]);
    expect(resolved.columns[1]?.isFinal).toBe(true);
    expect(resolved.entryColumnKey).toBe("todo");
    expect(resolved.fields[0]).toMatchObject({
      options: ["Small", "Groß"],
      defaultValue: "Groß",
      required: true,
    });
    expect(
      resolved.estimate?.points.map((point) => point.point?.value),
    ).toEqual(["5", "1", "2.5"]);
    // de-DE has no whiteboard labels: en-US fills in when not strict.
    expect(resolved.t("whiteboards:templates.labels.roadmap.now")).toBe("Now");
  });

  it("reports missing keys in strict mode and throws when en-US lacks one", () => {
    const strict = resolveTemplate(tiny, "de-DE", source, { strict: true });
    expect(strict.missing).toContain(
      "whiteboards:templates.labels.roadmap.now",
    );
    const broken = {
      ...tiny,
      pitch: "projectTemplates:catalog.tiny.nope",
    } satisfies ProjectTemplate;
    expect(() => resolveTemplate(broken, "en-US", source)).toThrow(
      TemplateTextError,
    );
  });

  it("fills feature defaults and lets later layers win", () => {
    const fields = featureFields({ intake: true }, { cycles: false });
    expect(fields).toMatchObject({
      intakeEnabled: true,
      cyclesEnabled: false,
      viewsEnabled: true,
      estimatesEnabled: false,
    });
    expect(Object.keys(fields)).toHaveLength(10);
  });

  it("resolves the registered kanban template in German", () => {
    const kanban = findTemplate("kanban");
    expect(kanban).not.toBeNull();
    const resolved = resolveTemplate(
      kanban as ProjectTemplate,
      "de-DE",
      templateTextSource(),
    );
    expect(resolved.missing).toEqual([]);
    expect(resolved.columns).toHaveLength(6);
    expect(new Set(resolved.columns.map((c) => c.slug)).size).toBe(6);
    expect(resolved.name).not.toBe("");
  });
});
