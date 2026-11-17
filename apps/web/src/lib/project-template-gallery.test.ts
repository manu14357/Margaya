import { describe, expect, it } from "vitest";
import {
  BLANK_TEMPLATE_ID,
  GUIDED_TOUR_TEMPLATE_ID,
  isValidProjectKey,
  isValidProjectName,
  MAX_RECOMMENDED,
  normalizeSearch,
  recommendedTemplates,
  searchTemplates,
  templatesInCategory,
  visibleCategories,
} from "./project-template-gallery";

const t = (id: string, categories: string[], extra = {}) => ({
  id,
  categories,
  featured: false,
  name: id,
  pitch: `${id} pitch`,
  ...extra,
});

const catalog = [
  t(BLANK_TEMPLATE_ID, ["software-development", "work-management"]),
  t("bug-tracking", ["software-development"]),
  t("kanban", ["software-development", "work-management"], { featured: true }),
  t("scrum", ["software-development"]),
  t("project-management", ["work-management"], { featured: true }),
  t(GUIDED_TOUR_TEMPLATE_ID, ["work-management"], { featured: true }),
  t("general-service-desk", ["service-management"], {
    name: "Service desk",
    pitch: "Tickets from anyone",
    featured: true,
  }),
  t("cafe-orders", ["operations"], { name: "Café orders" }),
];

describe("templatesInCategory", () => {
  it("puts the category's featured picks first, then catalog order", () => {
    expect(
      templatesInCategory(catalog, "software-development").map((x) => x.id),
    ).toEqual(["scrum", "kanban", "bug-tracking"]);
  });

  it("never lists the blank template as a tile", () => {
    expect(
      templatesInCategory(catalog, "work-management").map((x) => x.id),
    ).not.toContain(BLANK_TEMPLATE_ID);
  });
});

describe("recommendedTemplates", () => {
  it("starts with the defaults without intent or history", () => {
    expect(
      recommendedTemplates(catalog)
        .slice(0, 3)
        .map((x) => x.id),
    ).toEqual(["kanban", "project-management", "general-service-desk"]);
  });

  it("orders by the intent's category, then the last template", () => {
    const ids = recommendedTemplates(catalog, {
      intent: "software-development",
      lastTemplateId: "cafe-orders",
    }).map((x) => x.id);
    expect(ids.slice(0, 4)).toEqual([
      "scrum",
      "kanban",
      "bug-tracking",
      "cafe-orders",
    ]);
  });

  it("caps the list and never recommends the guided tour", () => {
    const ids = recommendedTemplates(catalog).map((x) => x.id);
    expect(ids.length).toBeLessThanOrEqual(MAX_RECOMMENDED);
    expect(ids).not.toContain(GUIDED_TOUR_TEMPLATE_ID);
    expect(ids).not.toContain(BLANK_TEMPLATE_ID);
  });
});

describe("searchTemplates", () => {
  const categories = [{ id: "operations", name: "Operations" }];

  it("matches name and pitch without case or accents", () => {
    expect(searchTemplates(catalog, [], "CAFE").map((x) => x.id)).toEqual([
      "cafe-orders",
    ]);
    expect(searchTemplates(catalog, [], "tickets").map((x) => x.id)).toEqual([
      "general-service-desk",
    ]);
  });

  it("matches category names", () => {
    expect(
      searchTemplates(catalog, categories, "operat").map((x) => x.id),
    ).toEqual(["cafe-orders"]);
  });

  it("returns every tile for an empty query", () => {
    expect(searchTemplates(catalog, [], "  ")).toHaveLength(catalog.length - 1);
  });
});

describe("visibleCategories", () => {
  it("hides categories without templates", () => {
    const shown = visibleCategories(
      [
        { id: "software-development", name: "Software" },
        { id: "legal", name: "Legal" },
      ],
      catalog,
    );
    expect(shown.map((category) => category.id)).toEqual([
      "software-development",
    ]);
  });
});

describe("validation", () => {
  it("accepts 1 to 8 letters or digits in any script", () => {
    expect(isValidProjectKey("WEB")).toBe(true);
    expect(isValidProjectKey("ПРО")).toBe(true);
    expect(isValidProjectKey("")).toBe(false);
    expect(isValidProjectKey("TOOLONGKEY")).toBe(false);
    expect(isValidProjectKey("A-B")).toBe(false);
  });

  it("requires a trimmed name of at most 80 characters", () => {
    expect(isValidProjectName("  ")).toBe(false);
    expect(isValidProjectName("Website")).toBe(true);
    expect(isValidProjectName("x".repeat(81))).toBe(false);
  });

  it("normalizes search text", () => {
    expect(normalizeSearch("  Évènement ")).toBe("evenement");
  });
});
