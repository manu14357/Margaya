import { responseTimestamp, z } from "../openapi";

export const quickLinkSchema = z
  .object({
    id: z.string(),
    workspaceId: z.string(),
    url: z.string().openapi({ description: "The normalized URL." }),
    title: z.string().nullable(),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("QuickLink");

export const quickLinkListSchema = z.array(quickLinkSchema);

export const quickLinkRemovalSchema = z
  .object({ removed: z.boolean() })
  .openapi("QuickLinkRemoval");
