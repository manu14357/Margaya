import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import db, { schema } from "../../../apps/api/src/database";
import { subscribeToEvent } from "../../../apps/api/src/events";
import { createApp } from "../../../apps/api/src/index";
import { mockAuthenticatedSession } from "./auth";
import { createWorkspaceMember } from "./fixtures";

type User = typeof schema.userTable.$inferSelect;

export type StickyJson = {
  id: string;
  workspaceId: string;
  content: string;
  color: string;
  position: number;
  createdAt: string;
  updatedAt: string;
};

export type StickyPageJson = { items: StickyJson[]; nextCursor: string | null };

export type QuickLinkJson = {
  id: string;
  workspaceId: string;
  url: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
};

export function json(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

/** Collects every payload of an event, for the whole test file. */
export async function collectEvents(eventName: string) {
  const events: Array<Record<string, unknown>> = [];
  await subscribeToEvent<Record<string, unknown>>(eventName, async (data) => {
    events.push(data);
  });
  return events;
}

/** A workspace member signed in as the caller, with the app to call. */
export async function homeContext(role = "member") {
  const member = await createWorkspaceMember({ role });
  mockAuthenticatedSession(member.user);
  const { app } = createApp();
  return { ...member, app, workspaceId: member.workspace.id };
}

/** A second workspace that `user` also belongs to. */
export async function addSecondWorkspace(user: User, role = "member") {
  const [workspace] = await db
    .insert(schema.workspaceTable)
    .values({
      id: `workspace-${randomUUID()}`,
      createdAt: new Date(),
      name: "Second workspace",
      slug: `workspace-${randomUUID()}`,
    })
    .returning();
  if (!workspace) throw new Error("workspace insert failed");
  await db.insert(schema.workspaceUserTable).values({
    workspaceId: workspace.id,
    userId: user.id,
    role,
    joinedAt: new Date(),
  });
  return workspace.id;
}

export async function expectStatus(
  response: Response | Promise<Response>,
  status: number,
  text?: string,
) {
  const resolved = await response;
  expect(resolved.status).toBe(status);
  if (text !== undefined) expect(await resolved.text()).toBe(text);
  return resolved;
}
