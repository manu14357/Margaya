import db from "../database";
import { apiRouter, type BaseVariables } from "../openapi";
import { listWhiteboardActivity } from "./activity";
import {
  boardAsset,
  createWhiteboardAssetUpload,
  finalizeWhiteboardAsset,
  streamBoardAsset,
} from "./assets";
import {
  addWhiteboardElements,
  getWhiteboardContent,
  renderWhiteboardPreview,
} from "./controllers/content";
import {
  createWhiteboard,
  duplicateWhiteboard,
} from "./controllers/create-whiteboard";
import {
  deleteWhiteboard,
  setWhiteboardArchived,
  setWhiteboardLock,
} from "./controllers/lifecycle";
import {
  listTaskWhiteboards,
  listWhiteboards,
  listWorkspaceWhiteboards,
  workspaceListScope,
} from "./controllers/list-whiteboards";
import {
  assertCanEdit,
  updateWhiteboard,
} from "./controllers/update-whiteboard";
import { publishWhiteboard, unpublishWhiteboard } from "./publication";
import { elementsJson } from "./response";
import {
  addWhiteboardElementsRoute,
  archiveWhiteboardRoute,
  createWhiteboardAssetUploadRoute,
  createWhiteboardRoute,
  deleteWhiteboardRoute,
  duplicateWhiteboardRoute,
  finalizeWhiteboardAssetRoute,
  getWhiteboardAssetRoute,
  getWhiteboardContentRoute,
  getWhiteboardPreviewRoute,
  getWhiteboardRoute,
  listTaskWhiteboardsRoute,
  listWhiteboardActivityRoute,
  listWhiteboardsRoute,
  listWorkspaceWhiteboardsRoute,
  lockWhiteboardRoute,
  publishWhiteboardRoute,
  unarchiveWhiteboardRoute,
  unlockWhiteboardRoute,
  unpublishWhiteboardRoute,
  updateWhiteboardRoute,
} from "./routes";
import {
  getWhiteboardResponse,
  loadWhiteboard,
  whiteboardCallerOf,
} from "./shared";
// Rooms install their REST hooks and event subscribers on import.
import "./collab/rooms";
import "./collab/subscribers";

type WhiteboardVariables = BaseVariables & {
  workspaceId: string;
  projectId: string | null;
};

const PREVIEW_HEADERS = {
  "Content-Type": "image/svg+xml; charset=utf-8",
  "Cache-Control": "private, max-age=60",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy":
    "default-src 'none'; img-src data: 'self'; style-src 'unsafe-inline'",
};

// Literal paths (/, /by-task/..., /workspace/...) are registered before the {id} routes.
const whiteboard = apiRouter<WhiteboardVariables>()
  .openapi(listWhiteboardsRoute, async (c) => {
    const query = c.req.valid("query");
    return c.json(
      await listWhiteboards({
        projectId: query.projectId,
        archived: query.archived === "true",
        q: query.q,
        caller: await whiteboardCallerOf(c),
      }),
      200,
    );
  })
  .openapi(createWhiteboardRoute, async (c) =>
    c.json(
      await createWhiteboard({
        workspaceId: c.get("workspaceId"),
        input: c.req.valid("json"),
        caller: await whiteboardCallerOf(c),
      }),
      201,
    ),
  )
  .openapi(listTaskWhiteboardsRoute, async (c) =>
    c.json(
      await listTaskWhiteboards({
        taskId: c.req.valid("param").taskId,
        workspaceId: c.get("workspaceId"),
        caller: await whiteboardCallerOf(c),
      }),
      200,
    ),
  )
  .openapi(listWorkspaceWhiteboardsRoute, async (c) => {
    const query = c.req.valid("query");
    const [caller, scope] = await Promise.all([
      whiteboardCallerOf(c),
      workspaceListScope(c),
    ]);
    return c.json(
      await listWorkspaceWhiteboards({
        workspaceId: c.get("workspaceId"),
        archived: query.archived === "true",
        q: query.q,
        caller,
        ...scope,
      }),
      200,
    );
  })
  .openapi(getWhiteboardRoute, async (c) =>
    c.json(
      await getWhiteboardResponse(
        c.req.valid("param").id,
        await whiteboardCallerOf(c),
      ),
      200,
    ),
  )
  .openapi(listWhiteboardActivityRoute, async (c) =>
    c.json(
      await listWhiteboardActivity(
        c.req.valid("param").id,
        c.req.valid("query").cursor,
      ),
      200,
    ),
  )
  .openapi(updateWhiteboardRoute, async (c) =>
    c.json(
      await updateWhiteboard({
        whiteboardId: c.req.valid("param").id,
        input: c.req.valid("json"),
        caller: await whiteboardCallerOf(c),
      }),
      200,
    ),
  )
  .openapi(deleteWhiteboardRoute, async (c) =>
    c.json(
      await deleteWhiteboard({
        whiteboardId: c.req.valid("param").id,
        caller: await whiteboardCallerOf(c),
      }),
      200,
    ),
  )
  .openapi(getWhiteboardContentRoute, async (c) => {
    const content = await getWhiteboardContent(c.req.valid("param").id);
    return c.json(
      { ...content, elements: elementsJson(content.elements) },
      200,
    );
  })
  .openapi(addWhiteboardElementsRoute, async (c) => {
    const result = await addWhiteboardElements({
      whiteboardId: c.req.valid("param").id,
      elements: c.req.valid("json").elements,
      caller: await whiteboardCallerOf(c),
    });
    return c.json({ ...result, elements: elementsJson(result.elements) }, 200);
  })
  .openapi(getWhiteboardPreviewRoute, async (c) => {
    const svg = await renderWhiteboardPreview(c.req.valid("param").id);
    return c.body(svg, 200, PREVIEW_HEADERS);
  })
  .openapi(duplicateWhiteboardRoute, async (c) =>
    c.json(
      await duplicateWhiteboard({
        whiteboardId: c.req.valid("param").id,
        title: c.req.valid("json")?.title,
        caller: await whiteboardCallerOf(c),
      }),
      201,
    ),
  )
  .openapi(lockWhiteboardRoute, async (c) =>
    c.json(
      await setWhiteboardLock({
        whiteboardId: c.req.valid("param").id,
        locked: true,
        caller: await whiteboardCallerOf(c),
      }),
      200,
    ),
  )
  .openapi(unlockWhiteboardRoute, async (c) =>
    c.json(
      await setWhiteboardLock({
        whiteboardId: c.req.valid("param").id,
        locked: false,
        caller: await whiteboardCallerOf(c),
      }),
      200,
    ),
  )
  .openapi(archiveWhiteboardRoute, async (c) =>
    c.json(
      await setWhiteboardArchived({
        whiteboardId: c.req.valid("param").id,
        archived: true,
        caller: await whiteboardCallerOf(c),
      }),
      200,
    ),
  )
  .openapi(unarchiveWhiteboardRoute, async (c) =>
    c.json(
      await setWhiteboardArchived({
        whiteboardId: c.req.valid("param").id,
        archived: false,
        caller: await whiteboardCallerOf(c),
      }),
      200,
    ),
  )
  .openapi(publishWhiteboardRoute, async (c) =>
    c.json(
      await publishWhiteboard(
        c.req.valid("param").id,
        await whiteboardCallerOf(c),
      ),
      200,
    ),
  )
  .openapi(unpublishWhiteboardRoute, async (c) =>
    c.json(
      await unpublishWhiteboard(
        c.req.valid("param").id,
        await whiteboardCallerOf(c),
      ),
      200,
    ),
  )
  .openapi(createWhiteboardAssetUploadRoute, async (c) => {
    const caller = await whiteboardCallerOf(c);
    const board = await loadWhiteboard(db, c.req.valid("param").id);
    assertCanEdit(board, caller);
    return c.json(
      await createWhiteboardAssetUpload(board, c.req.valid("json")),
      200,
    );
  })
  .openapi(finalizeWhiteboardAssetRoute, async (c) => {
    const caller = await whiteboardCallerOf(c);
    const { id, assetId } = c.req.valid("param");
    const board = await loadWhiteboard(db, id);
    assertCanEdit(board, caller);
    const asset = await finalizeWhiteboardAsset(
      board,
      assetId,
      c.req.valid("json"),
      caller.userId,
    );
    return c.json(
      {
        id: asset.id,
        whiteboardId: asset.whiteboardId,
        mimeType: asset.mimeType,
        size: asset.size,
        width: asset.width,
        height: asset.height,
        createdAt: asset.createdAt,
      },
      200,
    );
  })
  .openapi(getWhiteboardAssetRoute, async (c) => {
    const { id, assetId } = c.req.valid("param");
    return streamBoardAsset(
      await boardAsset(id, assetId),
      "private, max-age=300",
    );
  });

export default whiteboard;
