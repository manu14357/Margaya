import { z } from "../openapi";
import { PAGE_MESSAGES } from "./rules";
import { PAGE_ACCESS, PAGE_LIMITS, PAGE_LOGO_KINDS } from "./types";

// Request schemas for /api/page.

export const pageParam = z.object({ id: z.string() });

export const pageVersionParam = z.object({
  id: z.string(),
  versionId: z.string(),
});

export const projectPagesParam = z.object({ projectId: z.string() });

export const taskPageReferencesParam = z.object({ taskId: z.string() });

const pageTitle = z
  .string()
  .trim()
  .max(PAGE_LIMITS.titleLength, "Keep the title under 255 characters")
  .openapi({
    description:
      "At most 255 characters after trimming. Empty shows as Untitled.",
  });

const markdown = z
  .string()
  .refine(
    (value) => Buffer.byteLength(value, "utf8") <= PAGE_LIMITS.markdownBytes,
    "Keep the content under 1 MiB",
  )
  .openapi({
    description:
      "Markdown as the web editor writes it (GFM, line breaks on), including Margaya's custom tags for mentions, task links, attachments, embeds and page links. At most 1 MiB.",
  });

const logoKind = z.enum(PAGE_LOGO_KINDS).nullable().openapi({
  description:
    "emoji or icon; null (with logoValue null) removes the logo. Send it together with logoValue.",
});

const logoValue = z.string().max(64).nullable().openapi({
  description:
    "One emoji, or an icon name from the project icon catalog (for example FileText).",
});

const pageAccess = z.enum(PAGE_ACCESS).openapi({
  description:
    "public: every workspace member with page:read sees it. private: only its owner, admins included.",
});

export const createPageBody = z
  .object({
    title: pageTitle.optional(),
    access: pageAccess.optional().openapi({
      description: "Default public. Forced to private under a private parent.",
    }),
    parentId: z.string().min(1).nullable().optional().openapi({
      description:
        "A visible, non-archived page of the same project, at most 4 levels deep. Omitted or null for a top-level page.",
    }),
    afterId: z.string().min(1).nullable().optional().openapi({
      description:
        "Place the page right after this sibling (null: first). Omitted: last.",
    }),
    logoKind: logoKind.optional(),
    logoValue: logoValue.optional(),
    isFullWidth: z.boolean().optional(),
    content: markdown.optional(),
  })
  .strict()
  .openapi("CreatePageInput");

export const updatePageBody = z
  .object({
    title: pageTitle.optional(),
    logoKind: logoKind.optional(),
    logoValue: logoValue.optional(),
    isFullWidth: z.boolean().optional(),
  })
  .strict()
  .refine(
    (body) => Object.values(body).some((value) => value !== undefined),
    PAGE_MESSAGES.noFields,
  )
  .openapi("UpdatePageInput");

export const replacePageContentBody = z
  .object({ markdown })
  .strict()
  .openapi("ReplacePageContentInput");

export const movePageInTreeBody = z
  .object({
    parentId: z.string().min(1).nullable().openapi({
      description:
        "The new parent in the same project, or null for the top level.",
    }),
    afterId: z.string().min(1).nullable().optional().openapi({
      description:
        "Place the page right after this sibling under the new parent. Null or omitted: first.",
    }),
  })
  .strict()
  .openapi("MovePageInTreeInput");

export const updatePageAccessBody = z
  .object({ access: pageAccess })
  .strict()
  .openapi("UpdatePageAccessInput");

export const movePageToProjectBody = z
  .object({
    projectId: z.string().min(1).openapi({
      description: "Another project of the same workspace, with Pages on.",
    }),
  })
  .strict()
  .openapi("MovePageToProjectInput");

export const pageAssetUploadBody = z
  .object({
    filename: z.string().min(1).max(255),
    contentType: z.string().min(1).max(255),
    size: z.number(),
  })
  .openapi("PageAssetUploadInput");

export const finalizePageAssetUploadBody = z
  .object({
    key: z
      .string()
      .openapi({ description: "The key returned when the URL was issued." }),
    filename: z.string().min(1).max(255),
    contentType: z.string().min(1).max(255),
    size: z.number(),
  })
  .openapi("FinalizePageAssetUploadInput");

export type CreatePageInput = z.infer<typeof createPageBody>;
export type UpdatePageInput = z.infer<typeof updatePageBody>;
export type MovePageInTreeInput = z.infer<typeof movePageInTreeBody>;
