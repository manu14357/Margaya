import { z } from "../openapi";
import { MAX_LINK_TITLE_LENGTH, MAX_LINK_URL_LENGTH } from "../utils/link-url";

export const QUICK_LINKS_LIMIT = 50;
export const QUICK_LINK_BODY_BYTES = 8 * 1024;

export const workspaceIdQuery = z.object({ workspaceId: z.string() });

export const quickLinkParam = z.object({ id: z.string() });

const rawUrl = z.string().min(1).max(MAX_LINK_URL_LENGTH).openapi({
  description:
    "An http or https URL. Without a scheme, https:// is added. User names, passwords, other schemes and single-label hosts are refused. Stored normalized, at most 2,048 characters.",
});

const rawTitle = z.string().max(MAX_LINK_TITLE_LENGTH).nullable().openapi({
  description:
    "Optional display title, trimmed, at most 255 characters; blank or null means none.",
});

export const createQuickLinkBody = z.object({
  workspaceId: z.string(),
  url: rawUrl,
  title: rawTitle.optional(),
});

export const updateQuickLinkBody = z
  .object({
    url: rawUrl.optional(),
    title: rawTitle.optional(),
  })
  .strict()
  .openapi({ description: "Send url, title or both." });
