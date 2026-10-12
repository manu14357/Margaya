import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { expect } from "vitest";
import { settleAuditWrites } from "../../../apps/api/src/audit-log/record";
import db from "../../../apps/api/src/database";
import { auditLogTable } from "../../../apps/api/src/database/schema";
import { createApp } from "../../../apps/api/src/index";

export const ORIGIN = "http://localhost:5173";

type AuditRow = typeof auditLogTable.$inferSelect;

/** The workspace's audit entries, oldest first, once pending writes settle. */
export async function auditRows(
  workspaceId: string,
  action?: string,
): Promise<AuditRow[]> {
  await settleAuditWrites();
  const rows = await db
    .select()
    .from(auditLogTable)
    .where(eq(auditLogTable.workspaceId, workspaceId))
    .orderBy(asc(auditLogTable.createdAt));
  return action ? rows.filter((row) => row.action === action) : rows;
}

/** The single entry with this action; fails when there is not exactly one. */
export async function auditEntry(workspaceId: string, action: string) {
  const rows = await auditRows(workspaceId, action);
  expect(
    rows.map((row) => row.action),
    `entries for ${action}`,
  ).toHaveLength(1);
  return rows[0] as AuditRow;
}

/**
 * Real Better Auth sessions (cookies) against one app instance, for the
 * workspace, member, role and API key endpoints Better Auth serves itself.
 */
export function authClient() {
  const { app } = createApp();

  const call = async (
    path: string,
    body: unknown,
    cookie = "",
    headers: Record<string, string> = {},
  ) =>
    app.request(`/api/auth${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Origin: ORIGIN,
        "user-agent": "AuditTest/1.0",
        Cookie: cookie,
        ...headers,
      },
      body: JSON.stringify(body),
    });

  /** A call that must succeed; returns the parsed body. */
  const ok = async <T = Record<string, unknown>>(
    path: string,
    body: unknown,
    cookie: string,
  ): Promise<T> => {
    const response = await call(path, body, cookie);
    expect(response.status, await response.clone().text()).toBe(200);
    return (await response.json()) as T;
  };

  const signup = async (name: string) => {
    const email = `${name.toLowerCase()}-${randomUUID()}@example.com`;
    const response = await call("/sign-up/email", {
      name,
      email,
      password: "long-password-for-tests",
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as { user: { id: string } };
    const cookie = response.headers
      .getSetCookie()
      .map((entry) => entry.split(";")[0])
      .join("; ");
    return { id: body.user.id, email, name, cookie };
  };

  return { app, call, ok, signup };
}

export type AuthUser = Awaited<
  ReturnType<ReturnType<typeof authClient>["signup"]>
>;
