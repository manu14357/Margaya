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
import { normalizeApiServerUrl } from "../utils/openapi-spec";
import { publicPageAsset, readPublicPage } from "./read";

// Published pages (tag "Public pages"), mounted before the app-wide auth
// middleware: nobody signs in, and nothing about the viewer is read. Every
// response is noindex and no-store.

const TAGS = ["Public pages"];
const PAGE_404 =
  "Unknown or revoked link, or the workspace no longer allows public pages";

const tokenParam = z.object({
  token: z.string().openapi({ description: "The page's public link token." }),
});

const assetParam = tokenParam.extend({ assetId: z.string() });

const publicPageSchema = z
  .object({
    title: z.string().openapi({ description: "May be empty (Untitled)." }),
    logoKind: z.enum(["emoji", "icon"]).nullable(),
    logoValue: z.string().nullable(),
    isFullWidth: z.boolean(),
    updatedAt: z.string().openapi({ format: "date-time" }),
    content: z.record(z.string(), z.unknown()).openapi({
      description:
        "The page as editor JSON, rebuilt from an allowlist. Mentions, task links, file cards and links to unpublished pages are `redacted` nodes ({ kind }); a link to a published page carries its token and title. Images are the page's own uploads served through this link, or web images.",
    }),
  })
  .openapi("PublicPage");

const readChain: MiddlewareHandler[] = [perIpLimit(PUBLIC_LIMITS.read)];

const getPublicPageRoute = createRoute({
  method: "get",
  operationId: "getPublicPage",
  path: "/{token}",
  tags: TAGS,
  summary: "Get a public page",
  description:
    "A published page, read-only, without signing in. Answers 404 once the page is unpublished, made private, archived or deleted, when its project is trashed or has Pages off, or when its workspace no longer allows public pages or is pending deletion.",
  security: [],
  middleware: readChain,
  request: { params: tokenParam },
  responses: {
    200: jsonResponse("The page", publicPageSchema),
    404: errorResponse(PAGE_404),
    429: errorResponse("Too many requests; see Retry-After"),
  },
});

const getPublicPageAssetRoute = createRoute({
  method: "get",
  operationId: "getPublicPageAsset",
  path: "/{token}/asset/{assetId}",
  tags: TAGS,
  summary: "Get a public page image",
  description:
    "An image the published page shows, uploaded to its workspace. Other files are never served.",
  security: [],
  middleware: readChain,
  request: { params: assetParam },
  responses: {
    200: {
      description: "The image",
      content: { "image/*": { schema: { type: "string", format: "binary" } } },
    },
    404: errorResponse("Unknown link, or not an image of this page"),
    429: errorResponse("Too many requests; see Retry-After"),
  },
});

const publicPageRouter = apiRouter<BaseVariables>();
publicPageRouter.use("*", publicResponseHeaders());

const publicPageApi = publicPageRouter
  .openapi(getPublicPageRoute, async (c) => {
    const apiBaseUrl = normalizeApiServerUrl(
      process.env.MARGAYA_API_URL || new URL(c.req.url).origin,
    );
    return c.json(
      await readPublicPage(c.req.valid("param").token, apiBaseUrl),
      200,
    );
  })
  .openapi(getPublicPageAssetRoute, async (c) => {
    const { token, assetId } = c.req.valid("param");
    return publicPageAsset(token, assetId);
  });

export default publicPageApi;
