import { expect, test } from "../../fixtures";

test("an authenticated API context lists the workspace projects", async ({
  api,
  seed,
}) => {
  const response = await api.get("/api/project", {
    params: { workspaceId: seed.workspace.id },
  });
  expect(response.status()).toBe(200);

  const projects: { id: string; slug: string }[] = await response.json();
  expect(projects.map((project) => project.id)).toEqual(
    expect.arrayContaining([seed.projects.web.id, seed.projects.mobile.id]),
  );
});

test("a signed-out API context is rejected", async ({ apiAs, seed }) => {
  const anonymous = await apiAs("anonymous");
  const response = await anonymous.get("/api/project", {
    params: { workspaceId: seed.workspace.id },
  });
  expect(response.status()).toBe(401);
});
