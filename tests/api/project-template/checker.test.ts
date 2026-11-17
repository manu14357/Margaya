import { describe, expect, it } from "vitest";
import { listTemplates } from "../../../apps/api/src/project-template/catalog";
import { LOCALE_FRAGMENTS } from "../../../apps/api/src/project-template/locales";
import { WORKSPACE_STARTERS } from "../../../apps/api/src/project-template/starters";
import {
  APP_LOCALES,
  createTextSource,
  i18nTrees,
  type NamespacedTrees,
  templateTextSource,
  withFragments,
} from "../../../apps/api/src/project-template/text";
import type { ProjectTemplate } from "../../../apps/api/src/project-template/types";
import { validateTemplate } from "../../../apps/api/src/project-template/validate";

const errorsOf = (
  definition: ProjectTemplate,
  source = templateTextSource(),
  locales?: readonly string[],
) =>
  validateTemplate(definition, source, locales ? { locales } : undefined)
    .filter((issue) => issue.severity === "error")
    .map((issue) => `${issue.locale ?? ""} ${issue.path}: ${issue.message}`);

describe("every registered template", () => {
  const templates = listTemplates();

  it("is registered", () => {
    expect(templates.length).toBeGreaterThan(0);
  });

  it.each(templates.map((template) => [template.id, template] as const))(
    "%s passes the checker in all 20 locales",
    (_id, template) => {
      expect(errorsOf(template)).toEqual([]);
    },
  );
});

describe("workspace starters", () => {
  it("have unique ids, at most five projects with unique keys, and text in every locale", () => {
    const source = templateTextSource();
    expect(new Set(WORKSPACE_STARTERS.map((s) => s.id)).size).toBe(
      WORKSPACE_STARTERS.length,
    );
    for (const starter of WORKSPACE_STARTERS) {
      expect(starter.projects.length).toBeLessThanOrEqual(5);
      const keys = starter.projects.map((project) => project.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const key of keys) expect(key).toMatch(/^[A-Z0-9]{2,5}$/);
      for (const locale of APP_LOCALES) {
        const texts = [
          starter.name,
          starter.description,
          ...starter.projects.flatMap((project) => project.name ?? []),
        ];
        for (const key of texts) {
          expect(source.lookup(locale, key), `${locale} ${key}`).toBeTruthy();
        }
      }
    }
  });
});

describe("the checker catches broken definitions", () => {
  const base = listTemplates().find((template) => template.id === "kanban");
  if (!base) throw new Error("kanban is not registered");
  const english = ["en-US"] as const;

  it("reserved and duplicate column slugs", () => {
    const trees: NamespacedTrees = withFragments(i18nTrees(), [
      ...LOCALE_FRAGMENTS,
      { "en-US": { content: { kanban: { reserved: "Planned" } } } },
    ]);
    const source = createTextSource(trees);
    const broken: ProjectTemplate = {
      ...base,
      columns: [
        ...base.columns,
        {
          key: "planned",
          name: "projectTemplates:content.kanban.reserved",
          group: "unstarted",
        },
        {
          key: "again",
          name: "projectTemplates:common.statuses.done",
          group: "completed",
        },
      ],
    };
    const errors = errorsOf(broken, source, english);
    expect(errors.join("\n")).toContain('slugs to reserved "planned"');
    expect(errors.join("\n")).toContain('two columns slug to "done"');
  });

  it("unknown references, bad colours, missing features and roles", () => {
    const broken = {
      ...base,
      icon: "NotAnIcon",
      labels: [
        {
          key: "x",
          name: "projectTemplates:common.labels.waiting",
          color: "blue",
        },
      ],
      project: {
        ...base.project,
        features: { ...base.project.features, views: false },
      },
      automationRules: [
        {
          name: "projectTemplates:content.kanban.rules.expediteAttention",
          trigger: { type: "status_changed", to: ["nowhere"] },
          actions: [{ type: "notify", roles: [] }],
        },
      ],
    } as unknown as ProjectTemplate;
    const errors = errorsOf(broken, templateTextSource(), english).join("\n");
    expect(errors).toContain('"NotAnIcon" is not a project icon name');
    expect(errors).toContain('colour "blue" is not in the palette');
    expect(errors).toContain('views needs "views" on');
    expect(errors).toContain('unknown column "nowhere"');
    expect(errors).toContain("notify needs at least one role");
    expect(errors).toContain('unknown label "expedite"');
  });

  it("missing text in a locale and foreign text keys", () => {
    const broken: ProjectTemplate = {
      ...base,
      pitch: "projectTemplates:catalog.kanban.nothingHere",
      columns: [
        ...base.columns.slice(0, 5),
        {
          key: "x",
          name: "projectTemplates:content.scrum.status",
          group: "cancelled",
        },
      ],
    };
    const errors = errorsOf(broken, templateTextSource(), [
      "en-US",
      "de-DE",
    ]).join("\n");
    expect(errors).toContain(
      'pitch: must be "projectTemplates:catalog.kanban.pitch"',
    );
    expect(errors).toContain("use projectTemplates:common.*");
    expect(errors).toContain(
      "de-DE text: missing text for projectTemplates:catalog.kanban.nothingHere",
    );
  });

  it("unknown template variables and too many sample tasks", () => {
    const source = createTextSource(
      withFragments(i18nTrees(), [
        ...LOCALE_FRAGMENTS,
        { "en-US": { content: { kanban: { bad: "Hi {{task.owner}}" } } } },
      ]),
    );
    const sampleTask = base.sample?.tasks[0];
    if (!sampleTask) throw new Error("kanban has no sample tasks");
    const broken: ProjectTemplate = {
      ...base,
      automationRules: [
        {
          name: "projectTemplates:content.kanban.rules.overdueFixedDate",
          trigger: { type: "comment_added" },
          actions: [
            {
              type: "add_comment",
              template: "projectTemplates:content.kanban.bad",
            },
          ],
        },
      ],
      sample: {
        tasks: Array.from({ length: 26 }, (_, index) => ({
          ...sampleTask,
          key: `t${index}`,
          recurrence: undefined,
        })),
      },
    };
    expect(errorsOf(broken, source, english).join("\n")).toContain(
      "26 tasks; at most 25",
    );
    // Structural errors stop the per-locale checks, so check text separately.
    const variables = errorsOf(
      { ...broken, sample: base.sample },
      source,
      english,
    );
    expect(variables.join("\n")).toContain("unknown variable {{task.owner}}");
  });

  it("estimate values per locale", () => {
    const broken = {
      ...base,
      project: {
        ...base.project,
        features: { ...base.project.features, estimates: true },
      },
      estimate: {
        name: "projectTemplates:content.kanban.labels.expedite",
        type: "points",
        values: ["1", "1000"],
      },
    } as unknown as ProjectTemplate;
    expect(
      errorsOf(broken, templateTextSource(), english).join("\n"),
    ).toContain('"1000": too_large');
  });

  it("view and sample rules", () => {
    const broken = {
      ...base,
      views: [
        {
          name: "projectTemplates:content.kanban.views.aging",
          filters: {
            root: {
              key: "dueDate",
              operator: "withinNext",
              amount: 400,
              unit: "days",
            },
          },
          display: { orderBy: { field: "voteScore" } },
        },
      ],
      sample: {
        tasks: [
          {
            key: "a",
            title: "projectTemplates:content.kanban.samples.tls",
            column: "ready",
            startInDays: 5,
            dueInDays: 1,
            relations: [{ type: "blocks", to: "b" }],
          },
          {
            key: "b",
            title: "projectTemplates:content.kanban.samples.tls",
            column: "ready",
            relations: [{ type: "blocks", to: "a" }],
            recurrence: { frequency: "daily", weekdays: [1] },
          },
        ],
      },
    } as unknown as ProjectTemplate;
    const errors = errorsOf(broken, templateTextSource(), english).join("\n");
    expect(errors).toContain("amount must be a whole number from 1 to 365");
    expect(errors).toContain('ordering by "voteScore"');
    expect(errors).toContain("starts after it is due");
    expect(errors).toContain("blocks relations form a loop");
    expect(errors).toContain("weekdays only applies to a weekly repeat");
  });
});
