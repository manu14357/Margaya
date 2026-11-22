import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

// DELETE/PATCH /ai/skills/{id} and /ai/memory/{id} read the workspace from
// the skill or note, so `?workspaceId=` is optional.

const WORKSPACE_BY_ID: Record<string, string> = {
  "skill-mine": "workspace-mine",
  "note-mine": "workspace-mine",
  "skill-theirs": "workspace-theirs",
};

vi.mock("../../../apps/api/src/database", async () => {
  const schema = await import("../../../apps/api/src/database/schema");
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const dialect = new PgDialect();
  let boundId: string | undefined;
  const chain = {
    select: () => chain,
    from: () => chain,
    where: (condition: Parameters<typeof dialect.sqlToQuery>[0]) => {
      const [id] = dialect.sqlToQuery(condition).params;
      boundId = typeof id === "string" ? id : undefined;
      return chain;
    },
    limit: async () => {
      const workspaceId = boundId ? WORKSPACE_BY_ID[boundId] : undefined;
      return workspaceId ? [{ workspaceId }] : [];
    },
  };
  return { default: chain, schema };
});

vi.mock("../../../apps/api/src/utils/validate-workspace-access", async () => {
  const { HTTPException } = await import("hono/http-exception");
  return {
    validateWorkspaceAccess: async (_userId: string, workspaceId: string) => {
      if (workspaceId !== "workspace-mine") {
        throw new HTTPException(403, { message: "No access" });
      }
    },
  };
});

const { workspaceAccess } = await import(
  "../../../apps/api/src/utils/workspace-access-middleware"
);

function app() {
  return new Hono<{ Variables: { userId: string; workspaceId: string } }>()
    .use("*", async (c, next) => {
      c.set("userId", "user-1");
      return next();
    })
    .delete("/skills/:id", workspaceAccess.fromAiSkill(), (c) =>
      c.json({ workspaceId: c.get("workspaceId") }),
    )
    .delete("/memory/:id", workspaceAccess.fromAiMemoryNote(), (c) =>
      c.json({ workspaceId: c.get("workspaceId") }),
    );
}

describe("workspaceAccess for AI skills and memory notes", () => {
  it("reads the workspace from the skill or note without ?workspaceId=", async () => {
    const skill = await app().request("/skills/skill-mine", {
      method: "DELETE",
    });
    expect(skill.status).toBe(200);
    expect(await skill.json()).toEqual({ workspaceId: "workspace-mine" });
    const note = await app().request("/memory/note-mine", {
      method: "DELETE",
    });
    expect(note.status).toBe(200);
  });

  it("checks access to the entity's own workspace, whatever the query says", async () => {
    const res = await app().request(
      "/skills/skill-theirs?workspaceId=workspace-mine",
      { method: "DELETE" },
    );
    expect(res.status).toBe(403);
  });

  it("answers 404 for an unknown id", async () => {
    const res = await app().request("/memory/missing", { method: "DELETE" });
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Memory note not found");
  });
});
