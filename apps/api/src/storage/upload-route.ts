import { HTTPException } from "hono/http-exception";
import { apiRouter, createRoute, errorResponse, z } from "../openapi";
import {
  InvalidStorageKeyError,
  LocalObjectExistsError,
  LocalUploadSizeError,
  writeLocalObject,
} from "./local";
import { maxUploadBytes, storageDriver } from "./s3";
import { verifyUploadToken } from "./upload-token";

const INVALID_LINK = "This upload link is invalid or has expired";

const uploadRoute = createRoute({
  method: "put",
  operationId: "uploadStorageObject",
  path: "/upload/{token}",
  tags: ["Assets"],
  summary: "Upload a file to the built-in store",
  description:
    "Receives the bytes of a browser upload when the instance stores files on its own disk (no S3 configured). The upload endpoints (task images, attachments, page files) answer with this URL in place of a presigned S3 URL; the token in the path is signed by the server, expires like a presigned URL, and allows exactly one object with the approved content type and size. Send the file as the raw body with the given Content-Type, then finalize the upload as with S3. Answers 404 when the instance uses S3.",
  security: [],
  request: {
    params: z.object({
      token: z.string().max(4096).openapi({
        description: "The signed upload token from the upload endpoint.",
      }),
    }),
  },
  responses: {
    200: { description: "The file is stored; finalize the upload next" },
    400: errorResponse(
      "The Content-Type or byte count doesn't match the upload, or no body",
    ),
    403: errorResponse("The upload link is invalid or expired"),
    404: errorResponse("This instance doesn't use the built-in store"),
    409: errorResponse("A file was already uploaded with this link"),
    413: errorResponse("The body is larger than the approved size"),
  },
});

const storageUpload = apiRouter().openapi(uploadRoute, async (c) => {
  if (storageDriver() !== "local") {
    throw new HTTPException(404, { message: "Not found" });
  }
  const grant = verifyUploadToken(c.req.valid("param").token);
  if (!grant) throw new HTTPException(403, { message: INVALID_LINK });

  const contentType = (c.req.header("content-type") ?? "").trim();
  if (contentType.toLowerCase() !== grant.contentType.toLowerCase()) {
    throw new HTTPException(400, {
      message: "Content-Type does not match the upload",
    });
  }
  // A limit lowered after the link was issued still applies.
  if (grant.size > maxUploadBytes()) {
    throw new HTTPException(413, {
      message: "Upload exceeds the maximum upload size.",
    });
  }
  const declared = c.req.header("content-length");
  if (declared !== undefined && declared.trim() !== "") {
    const length = Number(declared);
    if (length > grant.size) {
      throw new HTTPException(413, {
        message: "The body is larger than the approved size",
      });
    }
    if (length !== grant.size) {
      throw new HTTPException(400, {
        message: "The body size does not match the upload",
      });
    }
  }
  const body = c.req.raw.body;
  if (!body) throw new HTTPException(400, { message: "The body is empty" });

  try {
    await writeLocalObject(grant.key, body, {
      contentType: grant.contentType,
      maxBytes: grant.size,
      expectedSize: grant.size,
    });
  } catch (error) {
    if (error instanceof LocalObjectExistsError) {
      throw new HTTPException(409, {
        message: "A file was already uploaded with this link",
      });
    }
    if (error instanceof LocalUploadSizeError) {
      throw error.tooLarge
        ? new HTTPException(413, {
            message: "The body is larger than the approved size",
          })
        : new HTTPException(400, {
            message: "The body size does not match the upload",
          });
    }
    if (error instanceof InvalidStorageKeyError) {
      throw new HTTPException(400, { message: "Invalid storage key" });
    }
    // File system errors can name paths on the server; never echo them.
    console.error("Local upload failed", error);
    throw new HTTPException(500, { message: "Unable to store the file" });
  }
  return c.body(null, 200);
});

export default storageUpload;
