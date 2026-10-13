import { expect, test } from "../../fixtures";
import {
  documentedOperationKeys,
  findBrandLeaks,
  loadDocsConfig,
  loadOpenApi,
  openApiOperations,
} from "../../helpers/docs-site";

// Opt-in docs-site project: E2E_DOCS_SITE=1 pnpm e2e --project=docs-site
//
// The API reference tab is generated from the committed apps/docs/openapi.json
// and the endpoint pages docs.json lists. The rendered pages are covered in
// docs.spec.ts; these checks tie the navigation to the spec.

const config = loadDocsConfig();
const spec = loadOpenApi();
const operations = openApiOperations(spec);
const documented = documentedOperationKeys(config);
const byId = new Map(
  operations.map((operation) => [operation.operationId, operation]),
);

test("the API reference tab is generated from openapi.json", () => {
  const tab = config.navigation.tabs.find(
    (entry) => entry.tab === "API Reference",
  );
  expect(tab?.openapi).toBe("openapi.json");
});

test("openapi.json is a Margaya OpenAPI 3.1 document", () => {
  expect(spec.openapi).toMatch(/^3\.1\./);
  expect(spec.info.title).toBe("Margaya API");
  expect(spec.info.version).toBeTruthy();
  expect(spec.servers?.[0]?.url).toMatch(/margaya/);
  expect(operations.length).toBeGreaterThan(200);
  expect(findBrandLeaks(JSON.stringify(spec))).toEqual([]);
});

test("every operation has a unique id, a tag and at least one response", () => {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const operation of operations) {
    const key = `${operation.method} ${operation.path}`;
    if (!operation.operationId) problems.push(`${key}: no operationId`);
    else if (seen.has(operation.operationId))
      problems.push(`${key}: duplicate ${operation.operationId}`);
    else seen.add(operation.operationId);
    if (operation.tags.length === 0) problems.push(`${key}: no tag`);
    if (Object.keys(operation.responses).length === 0)
      problems.push(`${key}: no responses`);
  }
  expect(problems).toEqual([]);
});

test("every endpoint page points at an operation in openapi.json", () => {
  const keys = new Set(
    operations.map((operation) => `${operation.method} ${operation.path}`),
  );
  const problems = [...documented]
    .filter(([key]) => !keys.has(key))
    .map(([key, page]) => `${page}: ${key} is not in openapi.json`);
  expect(documented.size).toBeGreaterThan(200);
  expect(problems).toEqual([]);
});

test.describe("spot checks", () => {
  const cases = [
    {
      operationId: "listTasks",
      method: "GET",
      path: "/task/tasks/{projectId}",
    },
    { operationId: "createTask", method: "POST", path: "/task/{projectId}" },
    { operationId: "getTask", method: "GET", path: "/task/{id}" },
    { operationId: "listProjects", method: "GET", path: "/project" },
    { operationId: "createProject", method: "POST", path: "/project" },
    { operationId: "listNotifications", method: "GET", path: "/notification" },
    {
      operationId: "markAllNotificationsAsRead",
      method: "PATCH",
      path: "/notification/read-all",
    },
  ];

  for (const entry of cases) {
    test(`${entry.operationId} is in the spec and has a reference page`, () => {
      const operation = byId.get(entry.operationId);
      expect(operation, entry.operationId).toBeDefined();
      expect(operation?.method).toBe(entry.method);
      expect(operation?.path).toBe(entry.path);
      expect(documented.get(`${entry.method} ${entry.path}`)).toMatch(
        new RegExp(`/${entry.operationId}$`),
      );
    });
  }

  test("views, intake and home operations are in the spec", () => {
    for (const operationId of [
      "listViews",
      "createView",
      "getView",
      "listIntakeItems",
      "createIntakeItem",
      "getHomePreferences",
      "updateHomePreferences",
    ]) {
      expect(byId.get(operationId), operationId).toBeDefined();
    }
    const tags = new Set(operations.flatMap((operation) => operation.tags));
    for (const tag of [
      "Tasks",
      "Projects",
      "Notifications",
      "Views",
      "Intake",
      "Home",
    ]) {
      expect(tags, tag).toContain(tag);
    }
  });

  test("views, intake and home operations have reference pages", () => {
    const missing = ["Views", "Intake", "Home"].flatMap((tag) =>
      operations
        .filter((operation) => operation.tags.includes(tag))
        .map((operation) => `${operation.method} ${operation.path}`)
        .filter((key) => !documented.has(key)),
    );
    expect(missing).toEqual([]);
  });
});

test("every operation in openapi.json has a reference page", () => {
  const missing = operations
    .map(
      (operation) =>
        `${operation.method} ${operation.path} (${operation.tags.join(", ")})`,
    )
    .filter((label) => !documented.has(label.replace(/ \(.*\)$/, "")));
  expect(missing).toEqual([]);
});
