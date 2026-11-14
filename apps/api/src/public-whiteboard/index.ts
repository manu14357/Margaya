import type { MiddlewareHandler } from "hono";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../openapi";
import { perIpLimit, publicResponseHeaders } from "../public-board/gate";
import { PUBLIC_LIMITS } from "../public-board/limits";
import { elementsJson, publicWhiteboardSchema } from "../whiteboard/response";
import { publicWhiteboardAsset, readPublicWhiteboard } from "./read";

// Published whiteboards (tag "Public whiteboards"), mounted before the
// app-wide auth middleware: nobody signs in and nothing about the viewer is
// read. Every response is noindex and no-store.

const TAGS = ["Public whiteboards"];
const BOARD_404 =
  "Unknown or revoked link, or the workspace no longer allows public pages";

const tokenParam = z.object({
  token: z
    .string()
    .openapi({ description: "The whiteboard's public link token." }),
});

const assetParam = tokenParam.extend({ assetId: z.string() });

const readChain: MiddlewareHandler[] = [perIpLimit(PUBLIC_LIMITS.read)];

const getPublicWhiteboardRoute = createRoute({
  method: "get",
  operationId: "getPublicWhiteboard",
  path: "/{token}",
  tags: TAGS,
  summary: "Get a public whiteboard",
  description:
    "A published whiteboard, read-only, without signing in: its live elements, settings and a snapshot of the task cards it shows (tasks of its own project only). Answers 404 once the board is unpublished, archived or deleted, when its project is archived, trashed or has Whiteboards off, or when its workspace no longer allows public pages or is pending deletion.",
  security: [],
  middleware: readChain,
  request: { params: tokenParam },
  responses: {
    200: jsonResponse("The whiteboard", publicWhiteboardSchema),
    404: errorResponse(BOARD_404),
    429: errorResponse("Too many requests; see Retry-After"),
  },
});

const getPublicWhiteboardAssetRoute = createRoute({
  method: "get",
  operationId: "getPublicWhiteboardAsset",
  path: "/{token}/assets/{assetId}",
  tags: TAGS,
  summary: "Get a public whiteboard image",
  description:
    "An image the published whiteboard shows. Images of other boards, or no longer on this one, are never served.",
  security: [],
  middleware: readChain,
  request: { params: assetParam },
  responses: {
    200: {
      description: "The image",
      content: { "image/*": { schema: { type: "string", format: "binary" } } },
    },
    404: errorResponse("Unknown link, or not an image of this whiteboard"),
    429: errorResponse("Too many requests; see Retry-After"),
  },
});

const publicWhiteboardRouter = apiRouter<BaseVariables>();
publicWhiteboardRouter.use("*", publicResponseHeaders());

const publicWhiteboardApi = publicWhiteboardRouter
  .openapi(getPublicWhiteboardRoute, async (c) => {
    const board = await readPublicWhiteboard(c.req.valid("param").token);
    return c.json({ ...board, elements: elementsJson(board.elements) }, 200);
  })
  .openapi(getPublicWhiteboardAssetRoute, async (c) => {
    const { token, assetId } = c.req.valid("param");
    return publicWhiteboardAsset(token, assetId);
  });

export default publicWhiteboardApi;
