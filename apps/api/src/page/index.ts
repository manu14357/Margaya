import { apiRouter, type BaseVariables } from "../openapi";
import { normalizeApiServerUrl } from "../utils/openapi-spec";
import { createPageAssetUpload, finalizePageAssetUpload } from "./assets";
import updatePageAccess from "./controllers/access-page";
import setPageArchived from "./controllers/archive-page";
import createPage from "./controllers/create-page";
import deletePage from "./controllers/delete-page";
import duplicatePage from "./controllers/duplicate-page";
import listPages from "./controllers/list-pages";
import setPageLock from "./controllers/lock-page";
import movePageInTree from "./controllers/move-in-tree";
import movePageToProject from "./controllers/move-to-project";
import {
  listPageBacklinks,
  listTaskPageReferences,
} from "./controllers/page-links";
import {
  getPageVersion,
  listPageVersions,
  restorePageVersion,
} from "./controllers/page-versions";
import {
  getPageResponse,
  loadVisiblePage,
  pageCallerOf,
} from "./controllers/shared";
import {
  assertCanEdit,
  markPageAiAssisted,
  replacePageContent,
  updatePage,
} from "./controllers/update-page";
import {
  archivePageRoute,
  createPageAssetUploadRoute,
  createPageRoute,
  deletePageRoute,
  duplicatePageRoute,
  finalizePageAssetUploadRoute,
  getPageRoute,
  getPageVersionRoute,
  listPageBacklinksRoute,
  listPagesRoute,
  listPageVersionsRoute,
  listTaskPageReferencesRoute,
  lockPageRoute,
  markPageAiRoute,
  movePageInTreeRoute,
  movePageToProjectRoute,
  replacePageContentRoute,
  restorePageVersionRoute,
  unarchivePageRoute,
  unlockPageRoute,
  updatePageAccessRoute,
  updatePageRoute,
} from "./routes";
import "../notification/page-mentions";
import "../notification/page-watchers";
import db from "../database";
import { hasWorkspacePermission } from "../utils/require-workspace-permission";
import {
  createPageCommentRoute,
  deletePageCommentRoute,
  getPageSubscriptionRoute,
  listPageCommentsRoute,
  subscribeToPageRoute,
  unsubscribeFromPageRoute,
  updatePageCommentRoute,
} from "./comment-routes";
import {
  createPageComment,
  deletePageComment,
  listPageComments,
  updatePageComment,
} from "./comments";
import { getPagePublication, publishPage, unpublishPage } from "./publication";
import {
  deletePageTemplateRoute,
  getPagePublicationRoute,
  listPageTemplatesRoute,
  publishPageRoute,
  savePageTemplateRoute,
  unpublishPageRoute,
} from "./sharing-routes";
import {
  deletePageTemplate,
  listPageTemplates,
  savePageAsTemplate,
} from "./templates";
import { muteForPage, pageSubscriptionOf, subscribeToPage } from "./watching";

type PageVariables = BaseVariables & {
  workspaceId: string;
  projectId: string | null;
};

// Literal paths (/project/..., /task/...) are registered before the {id} routes.
const page = apiRouter<PageVariables>()
  .openapi(listPagesRoute, async (c) =>
    c.json(
      await listPages({
        projectId: c.req.valid("param").projectId,
        caller: await pageCallerOf(c),
      }),
      200,
    ),
  )
  .openapi(createPageRoute, async (c) =>
    c.json(
      await createPage({
        workspaceId: c.get("workspaceId"),
        projectId: c.req.valid("param").projectId,
        input: c.req.valid("json") ?? {},
        caller: await pageCallerOf(c),
      }),
      200,
    ),
  )
  .openapi(listPageTemplatesRoute, async (c) =>
    c.json(
      await listPageTemplates(
        c.req.valid("param").projectId,
        await pageCallerOf(c),
      ),
      200,
    ),
  )
  .openapi(deletePageTemplateRoute, async (c) =>
    c.json(
      await deletePageTemplate({
        templateId: c.req.valid("param").templateId,
        workspaceId: c.get("workspaceId"),
        caller: await pageCallerOf(c),
      }),
      200,
    ),
  )
  .openapi(listTaskPageReferencesRoute, async (c) =>
    c.json(
      await listTaskPageReferences(
        c.req.valid("param").taskId,
        c.get("workspaceId"),
        await pageCallerOf(c),
      ),
      200,
    ),
  )
  .openapi(getPageRoute, async (c) =>
    c.json(
      await getPageResponse(c.req.valid("param").id, await pageCallerOf(c)),
      200,
    ),
  )
  .openapi(updatePageRoute, async (c) =>
    c.json(
      await updatePage({
        pageId: c.req.valid("param").id,
        input: c.req.valid("json"),
        caller: await pageCallerOf(c),
      }),
      200,
    ),
  )
  .openapi(replacePageContentRoute, async (c) =>
    c.json(
      await replacePageContent({
        pageId: c.req.valid("param").id,
        markdown: c.req.valid("json").markdown,
        aiAssist: c.req.valid("json").aiAssist,
        caller: await pageCallerOf(c),
      }),
      200,
    ),
  )
  .openapi(markPageAiRoute, async (c) =>
    c.json(
      await markPageAiAssisted({
        pageId: c.req.valid("param").id,
        feature: c.req.valid("json").feature,
        caller: await pageCallerOf(c),
      }),
      200,
    ),
  )
  .openapi(movePageInTreeRoute, async (c) =>
    c.json(
      await movePageInTree({
        pageId: c.req.valid("param").id,
        input: c.req.valid("json"),
        caller: await pageCallerOf(c),
      }),
      200,
    ),
  )
  .openapi(lockPageRoute, async (c) =>
    c.json(
      await setPageLock({
        pageId: c.req.valid("param").id,
        locked: true,
        caller: await pageCallerOf(c),
      }),
      200,
    ),
  )
  .openapi(unlockPageRoute, async (c) =>
    c.json(
      await setPageLock({
        pageId: c.req.valid("param").id,
        locked: false,
        caller: await pageCallerOf(c),
      }),
      200,
    ),
  )
  .openapi(updatePageAccessRoute, async (c) =>
    c.json(
      await updatePageAccess({
        pageId: c.req.valid("param").id,
        access: c.req.valid("json").access,
        caller: await pageCallerOf(c),
      }),
      200,
    ),
  )
  .openapi(archivePageRoute, async (c) =>
    c.json(
      await setPageArchived({
        pageId: c.req.valid("param").id,
        archived: true,
        caller: await pageCallerOf(c),
      }),
      200,
    ),
  )
  .openapi(unarchivePageRoute, async (c) =>
    c.json(
      await setPageArchived({
        pageId: c.req.valid("param").id,
        archived: false,
        caller: await pageCallerOf(c),
      }),
      200,
    ),
  )
  .openapi(deletePageRoute, async (c) =>
    c.json(
      await deletePage({
        pageId: c.req.valid("param").id,
        caller: await pageCallerOf(c),
      }),
      200,
    ),
  )
  .openapi(duplicatePageRoute, async (c) =>
    c.json(
      await duplicatePage({
        pageId: c.req.valid("param").id,
        caller: await pageCallerOf(c),
      }),
      200,
    ),
  )
  .openapi(movePageToProjectRoute, async (c) =>
    c.json(
      await movePageToProject({
        pageId: c.req.valid("param").id,
        targetProjectId: c.req.valid("json").projectId,
        caller: await pageCallerOf(c),
      }),
      200,
    ),
  )
  .openapi(savePageTemplateRoute, async (c) =>
    c.json(
      await savePageAsTemplate({
        pageId: c.req.valid("param").id,
        ...c.req.valid("json"),
        caller: await pageCallerOf(c),
      }),
      200,
    ),
  )
  .openapi(getPagePublicationRoute, async (c) =>
    c.json(
      await getPagePublication(
        c.req.valid("param").id,
        await pageCallerOf(c),
        await hasWorkspacePermission(c, { project: ["share"] }),
      ),
      200,
    ),
  )
  .openapi(publishPageRoute, async (c) =>
    c.json(
      await publishPage(c.req.valid("param").id, await pageCallerOf(c)),
      200,
    ),
  )
  .openapi(unpublishPageRoute, async (c) =>
    c.json(
      await unpublishPage(c.req.valid("param").id, await pageCallerOf(c)),
      200,
    ),
  )
  .openapi(listPageVersionsRoute, async (c) =>
    c.json(
      await listPageVersions(c.req.valid("param").id, await pageCallerOf(c)),
      200,
    ),
  )
  .openapi(getPageVersionRoute, async (c) => {
    const { id, versionId } = c.req.valid("param");
    return c.json(
      await getPageVersion(id, versionId, await pageCallerOf(c)),
      200,
    );
  })
  .openapi(restorePageVersionRoute, async (c) => {
    const { id, versionId } = c.req.valid("param");
    return c.json(
      await restorePageVersion(id, versionId, await pageCallerOf(c)),
      200,
    );
  })
  .openapi(listPageBacklinksRoute, async (c) =>
    c.json(
      await listPageBacklinks(c.req.valid("param").id, await pageCallerOf(c)),
      200,
    ),
  )
  .openapi(listPageCommentsRoute, async (c) =>
    c.json(
      await listPageComments(c.req.valid("param").id, await pageCallerOf(c)),
      200,
    ),
  )
  .openapi(createPageCommentRoute, async (c) =>
    c.json(
      await createPageComment(
        c.req.valid("param").id,
        c.req.valid("json").content,
        await pageCallerOf(c),
      ),
      200,
    ),
  )
  .openapi(updatePageCommentRoute, async (c) => {
    const { id, commentId } = c.req.valid("param");
    return c.json(
      await updatePageComment(
        id,
        commentId,
        c.req.valid("json").content,
        await pageCallerOf(c),
      ),
      200,
    );
  })
  .openapi(deletePageCommentRoute, async (c) => {
    const { id, commentId } = c.req.valid("param");
    return c.json(
      await deletePageComment(id, commentId, await pageCallerOf(c)),
      200,
    );
  })
  .openapi(getPageSubscriptionRoute, async (c) => {
    const caller = await pageCallerOf(c);
    const target = await loadVisiblePage(db, c.req.valid("param").id, caller);
    return c.json(await pageSubscriptionOf(target, caller.userId), 200);
  })
  .openapi(subscribeToPageRoute, async (c) => {
    const caller = await pageCallerOf(c);
    const target = await loadVisiblePage(db, c.req.valid("param").id, caller);
    await subscribeToPage(target.id, [caller.userId]);
    return c.json(await pageSubscriptionOf(target, caller.userId), 200);
  })
  .openapi(unsubscribeFromPageRoute, async (c) => {
    const caller = await pageCallerOf(c);
    const target = await loadVisiblePage(db, c.req.valid("param").id, caller);
    await muteForPage(target.id, caller.userId);
    return c.json(await pageSubscriptionOf(target, caller.userId), 200);
  })
  .openapi(createPageAssetUploadRoute, async (c) => {
    const caller = await pageCallerOf(c);
    const target = await loadVisiblePage(db, c.req.valid("param").id, caller);
    assertCanEdit(target, caller);
    return c.json(
      await createPageAssetUpload(target, c.req.valid("json")),
      200,
    );
  })
  .openapi(finalizePageAssetUploadRoute, async (c) => {
    const caller = await pageCallerOf(c);
    const target = await loadVisiblePage(db, c.req.valid("param").id, caller);
    assertCanEdit(target, caller);
    const apiBaseUrl = normalizeApiServerUrl(
      process.env.MARGAYA_API_URL || new URL(c.req.url).origin,
    );
    return c.json(
      await finalizePageAssetUpload(
        target,
        c.req.valid("json"),
        caller.userId,
        apiBaseUrl,
      ),
      200,
    );
  });

export default page;
