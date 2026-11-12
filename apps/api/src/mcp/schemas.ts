import { z } from "../openapi";
import { isMargayaResource } from "./metadata";
import { isValidRedirectUri } from "./redirect-uri";

const redirectUriSchema = z
  .string()
  .max(2048)
  .refine(isValidRedirectUri, "Invalid redirect URI");

// Clients such as Claude also ask for refresh_token. The server never issues
// one, so the grant is accepted here and omitted from the registration response.
export const clientRegistrationSchema = z.object({
  redirect_uris: z.array(redirectUriSchema).min(1).max(10),
  application_type: z.enum(["native", "web"]).optional().openapi({
    description:
      "The OpenID Connect application type the client declares (MCP 2026-07-28 asks clients to send it). Accepted for compatibility; both kinds are public clients.",
  }),
  client_name: z.string().max(100).optional(),
  token_endpoint_auth_method: z.literal("none").optional(),
  grant_types: z
    .array(z.enum(["authorization_code", "refresh_token"]))
    .max(2)
    .refine(
      (types) => types.includes("authorization_code"),
      "grant_types must include authorization_code",
    )
    .optional(),
  response_types: z.array(z.literal("code")).min(1).max(1).optional(),
});

export const authorizationQuerySchema = z.object({
  response_type: z.literal("code"),
  client_id: z.string().min(1).max(2048).openapi({
    description:
      "The client's id: one from dynamic registration, or an https URL of the client's metadata document (Client ID Metadata Documents), which Margaya fetches and checks.",
  }),
  redirect_uri: redirectUriSchema,
  code_challenge: z
    .string()
    .regex(/^[A-Za-z0-9_-]{43}$/)
    .openapi({
      description: "PKCE challenge; only S256 is accepted.",
    }),
  code_challenge_method: z.literal("S256"),
  state: z.string().max(1024).optional(),
  resource: z
    .string()
    .max(2048)
    .refine(isMargayaResource, "Unknown resource")
    .optional()
    .openapi({
      description:
        "Resource indicator (RFC 8707): the protected resource the token is for, such as https://margaya.example.com/api/mcp. A token request that repeats it must name the same resource.",
    }),
});

export const authorizationRequestParamSchema = z.object({
  requestId: z.string().min(1).max(128),
});

export const authorizationDecisionSchema = z.object({
  approved: z.boolean(),
});

export const oauthErrorSchema = z
  .object({ error: z.string(), error_description: z.string().optional() })
  .openapi("OAuthError");

export const clientRegistrationResponseSchema = z
  .object({
    client_id: z.string(),
    client_id_issued_at: z.number(),
    redirect_uris: z.array(z.string()),
    client_name: z.string().optional(),
    token_endpoint_auth_method: z.literal("none"),
    grant_types: z.array(z.literal("authorization_code")),
    response_types: z.array(z.literal("code")),
  })
  .openapi("McpClientRegistration");

export const authorizationRequestResponseSchema = z
  .object({
    client_name: z.string(),
    redirect_uri: z.string(),
    client_metadata_host: z.string().optional().openapi({
      description:
        "For a client identified by a metadata document URL: the host that published it. The client name comes from that document.",
    }),
  })
  .openapi("McpAuthorizationRequest");

export const authorizationDecisionResponseSchema = z
  .object({
    redirect: z.string().openapi({
      description:
        "Where to send the browser next: back to the client with a code on approval, or with an error on denial.",
    }),
  })
  .openapi("McpAuthorizationDecision");
