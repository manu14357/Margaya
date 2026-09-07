import { z } from "../openapi";

export const taskIdParam = z.object({ taskId: z.string() });

export const taskLinkParam = z.object({
  taskId: z.string(),
  linkId: z.string(),
});

// Raw lengths are only a coarse bound; the stored limits (2,048 for the
// normalized URL, 255 for the trimmed title) are checked after normalizing.
const rawUrl = z.string().max(4096).openapi({
  description:
    "An http or https URL. Without a scheme, https:// is assumed. User names, passwords, other schemes and single-label hosts are refused. Stored normalized, at most 2,048 characters.",
});

const rawTitle = z.string().max(1000).nullable().openapi({
  description:
    "Optional display title, trimmed, at most 255 characters; empty or null means none.",
});

export const createTaskLinkBody = z.object({
  url: rawUrl,
  title: rawTitle.optional(),
});

export const updateTaskLinkBody = z.object({
  url: rawUrl.optional(),
  title: rawTitle.optional(),
});
