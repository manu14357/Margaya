import { nullableResponseTimestamp, responseTimestamp, z } from "../openapi";
import { PAGE_ACCESS, PAGE_LOGO_KINDS } from "./types";

export const pageCapabilitiesSchema = z
  .object({
    canEdit: z.boolean().openapi({
      description:
        "Edit content, title, logo and width, move within the tree and restore versions: page:update, not locked or archived, and public or the caller's own.",
    }),
    canLock: z.boolean().openapi({
      description:
        "Lock and unlock: page:update and the owner, or page:delete.",
    }),
    canChangeAccess: z.boolean().openapi({
      description:
        "Make private or public: the owner with page:update, not archived.",
    }),
    canArchive: z.boolean().openapi({
      description:
        "Archive and restore: page:update and the owner, or page:delete.",
    }),
    canDelete: z.boolean().openapi({
      description:
        "Delete: archived, and the owner with page:update, or page:delete.",
    }),
    canDuplicate: z.boolean().openapi({ description: "page:create." }),
    canMove: z.boolean().openapi({
      description:
        "Move to another project: canArchive, not locked or archived.",
    }),
    canCreateSubpage: z.boolean().openapi({
      description:
        "page:create, not archived, public or the caller's own, and less than 5 levels deep.",
    }),
    canRestoreVersion: z.boolean().openapi({ description: "Same as canEdit." }),
    canComment: z.boolean().openapi({
      description: "Add comments: page:update, not archived.",
    }),
  })
  .openapi("PageCapabilities");

const pageSummaryShape = {
  id: z.string(),
  workspaceId: z.string(),
  projectId: z.string().nullable().openapi({
    description: "Always set today; reserved for workspace-level pages.",
  }),
  parentId: z.string().nullable(),
  position: z.number().int().openapi({
    description: "Order among siblings (same project and parent), ascending.",
  }),
  title: z
    .string()
    .openapi({ description: "May be empty (shown as Untitled)." }),
  logoKind: z.enum(PAGE_LOGO_KINDS).nullable(),
  logoValue: z.string().nullable(),
  access: z.enum(PAGE_ACCESS),
  ownerId: z.string().nullable(),
  isLocked: z.boolean(),
  lockedById: z.string().nullable(),
  lockedAt: nullableResponseTimestamp,
  archivedAt: nullableResponseTimestamp,
  isFullWidth: z.boolean(),
  createdById: z.string().nullable(),
  updatedById: z.string().nullable(),
  createdAt: responseTimestamp,
  updatedAt: responseTimestamp.openapi({
    description:
      "Last change to the content, title, logo or width (not lock, access, archive or position).",
  }),
  capabilities: pageCapabilitiesSchema,
};

export const pageSummarySchema = z
  .object(pageSummaryShape)
  .openapi("PageSummary", {
    description: "A page without its content.",
  });

export const pageSummaryListSchema = z.array(pageSummarySchema);

export const pageAncestorSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    logoKind: z.enum(PAGE_LOGO_KINDS).nullable(),
    logoValue: z.string().nullable(),
  })
  .openapi("PageAncestor");

export const pageSchema = z
  .object({
    ...pageSummaryShape,
    contentMarkdown: z.string().openapi({
      description:
        "The last saved markdown projection of the content. While people edit live it can lag behind by up to 10 seconds.",
    }),
    contentVersion: z.number().int().openapi({
      description: "Increases with every content write.",
    }),
    ancestors: z.array(pageAncestorSchema).openapi({
      description: "Root first. Ancestors the caller can't see are left out.",
    }),
  })
  .openapi("Page");

export const deletedPageSchema = z
  .object({ id: z.string(), projectId: z.string().nullable() })
  .openapi("DeletedPage");

export const pageCommentSchema = z
  .object({
    id: z.string(),
    pageId: z.string(),
    userId: z.string().nullable().openapi({
      description: "The author, or null when their account was deleted.",
    }),
    content: z.string(),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
    user: z
      .object({ name: z.string(), image: z.string().nullable() })
      .nullable()
      .openapi({
        description: "The author, or null when their account was deleted.",
      }),
    canEdit: z.boolean().openapi({
      description: "The caller wrote it and may still change the page.",
    }),
    canDelete: z.boolean().openapi({
      description:
        "The caller wrote it and has page:update, or has page:delete.",
    }),
  })
  .openapi("PageComment");

export const pageCommentListSchema = z
  .array(pageCommentSchema)
  .openapi("PageCommentList");

export const deletedPageCommentSchema = z
  .object({ id: z.string(), pageId: z.string() })
  .openapi("DeletedPageComment");

export const pageSubscriptionSchema = z
  .object({
    pageId: z.string(),
    subscribed: z.boolean().openapi({
      description:
        "The caller watches the page: they asked to, commented, were mentioned, or own it, and did not unwatch it since.",
    }),
  })
  .openapi("PageSubscription");

const pageVersionShape = {
  id: z.string(),
  pageId: z.string(),
  ownerId: z.string().nullable().openapi({
    description:
      "The person the version is attributed to (its latest contributor).",
  }),
  contributorIds: z.array(z.string()).openapi({
    description: "Everyone whose edits went into this version.",
  }),
  title: z
    .string()
    .openapi({ description: "The page title when it was saved." }),
  lastSavedAt: responseTimestamp,
  createdAt: responseTimestamp,
};

export const pageVersionSchema = z
  .object(pageVersionShape)
  .openapi("PageVersion");

export const pageVersionListSchema = z.array(pageVersionSchema);

export const pageVersionDetailSchema = z
  .object({
    ...pageVersionShape,
    contentJson: z.record(z.string(), z.unknown()).openapi({
      description: "The editor document (ProseMirror JSON).",
    }),
    contentMarkdown: z.string(),
  })
  .openapi("PageVersionDetail");

// Page uploads answer with the task upload schemas (TaskImageUpload,
// TaskImageAsset).
export { finalizedAssetSchema, imageUploadSchema } from "../task/response";

export const pageTemplateSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    scope: z.enum(["project", "workspace"]).openapi({
      description:
        "project: offered in its project only. workspace: offered in every project of the workspace.",
    }),
    projectId: z.string().nullable(),
    logoKind: z.enum(PAGE_LOGO_KINDS).nullable(),
    logoValue: z.string().nullable(),
    createdById: z.string().nullable(),
    createdAt: responseTimestamp,
    canDelete: z.boolean().openapi({
      description: "Who saved it (with page:create), or page:delete.",
    }),
  })
  .openapi("PageTemplate");

export const pageTemplateListSchema = z.array(pageTemplateSchema);

export const deletedPageTemplateSchema = z
  .object({ id: z.string() })
  .openapi("DeletedPageTemplate");

export const pagePublicationSchema = z
  .object({
    published: z.boolean(),
    token: z.string().nullable().openapi({
      description:
        "The unguessable link token while published. Unpublishing revokes it; publishing again issues a new one.",
    }),
    path: z.string().nullable().openapi({
      description:
        "The web path of the public page, e.g. /public-page/{token}.",
    }),
    publishedAt: nullableResponseTimestamp,
    allowed: z.boolean().openapi({
      description: "Whether the workspace allows public pages.",
    }),
    canPublish: z.boolean().openapi({
      description:
        "Allowed, project:share, and the page is visible to the workspace and not archived.",
    }),
    canUnpublish: z.boolean().openapi({
      description: "Published, and the caller has project:share.",
    }),
  })
  .openapi("PagePublication");
