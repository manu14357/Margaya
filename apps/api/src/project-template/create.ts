import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { userTable } from "../database/schema";
import type { TemplateApplyOptions } from "../project/controllers/create-project";
import { hasWorkspacePermission } from "../utils/require-workspace-permission";
import { prepareTemplate } from "./apply";
import { findTemplate } from "./catalog";
import { resolveTemplate } from "./resolve";
import { type AppLocale, pickLocale, templateTextSource } from "./text";

// Request-side glue for creating from a template: locale choice, the two
// permissions that reach beyond the new project, and the CPU-heavy
// preparation, all before the create transaction opens.

export const TEMPLATE_NOT_FOUND = "Template not found";
export const SAMPLE_DATA_FORBIDDEN =
  "Example tasks need the task:create permission";

/** The locale for template text: body or query, saved locale, header. */
export async function requestLocale(
  c: Context,
  requested: string | undefined,
): Promise<AppLocale> {
  let userLocale: string | null = null;
  const userId = c.get("userId") as string | undefined;
  if (!requested && userId) {
    const [row] = await db
      .select({ locale: userTable.locale })
      .from(userTable)
      .where(eq(userTable.id, userId))
      .limit(1);
    userLocale = row?.locale ?? null;
  }
  return pickLocale({
    requested,
    userLocale,
    acceptLanguage: c.req.header("accept-language"),
  });
}

export async function templateOptionsFor(
  c: Context,
  template: { id: string; sampleData?: boolean; locale?: string },
): Promise<TemplateApplyOptions> {
  const definition = findTemplate(template.id);
  if (!definition)
    throw new HTTPException(404, { message: TEMPLATE_NOT_FOUND });
  const sampleData = template.sampleData ?? false;
  if (sampleData && !(await hasWorkspacePermission(c, { task: ["create"] }))) {
    throw new HTTPException(403, { message: SAMPLE_DATA_FORBIDDEN });
  }
  const locale = await requestLocale(c, template.locale);
  const resolved = resolveTemplate(definition, locale, templateTextSource());
  return {
    prepared: prepareTemplate(resolved),
    canCreateLabels: await hasWorkspacePermission(c, { label: ["create"] }),
    sampleData,
  };
}
