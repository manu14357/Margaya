import { responseTimestamp, z } from "../openapi";

export const scimConnectionSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    workspaceId: z.string(),
    workspaceName: z.string(),
    provisionedUsers: z.number().int().openapi({
      description: "People this connection currently manages.",
    }),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("ScimConnection");

export const scimConnectionListSchema = z
  .object({
    baseUrl: z.string().openapi({
      description: "The SCIM base URL to give the identity provider.",
    }),
    items: z.array(scimConnectionSchema),
  })
  .openapi("ScimConnectionList");

export const scimConnectionTokenSchema = z
  .object({
    connection: scimConnectionSchema,
    baseUrl: z.string(),
    token: z.string().openapi({
      description:
        "The bearer token for the identity provider. Shown only in this response: only its hash is stored.",
    }),
  })
  .openapi("ScimConnectionToken");

export const samlConnectionSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    domains: z.array(z.string()),
    issuer: z.string(),
    entryPoint: z.string(),
    certificateFingerprint: z.string().openapi({
      description: "SHA-256 fingerprint of the signing certificate.",
    }),
    certificateExpiresAt: responseTimestamp,
    acsUrl: z.string().openapi({
      description:
        "The Assertion Consumer Service URL for the identity provider.",
    }),
    entityId: z.string().openapi({
      description: "This service provider's entity ID (the audience).",
    }),
    metadataUrl: z.string().openapi({
      description:
        "Service provider metadata the identity provider can import.",
    }),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("SamlConnection");

export const samlConnectionDraftSchema = z
  .object({
    key: z.string().openapi({
      description: "Send this when creating the connection.",
    }),
    acsUrl: z.string(),
    entityId: z.string(),
  })
  .openapi("SamlConnectionDraft");

export const samlConnectionListSchema = z
  .object({ items: z.array(samlConnectionSchema) })
  .openapi("SamlConnectionList");

export const identityConnectionDeletedSchema = z
  .object({ id: z.string(), deleted: z.literal(true) })
  .openapi("IdentityConnectionDeleted");
