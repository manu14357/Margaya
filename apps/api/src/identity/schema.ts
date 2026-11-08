import { z } from "../openapi";

export const identityConnectionParam = z.object({ id: z.string().min(1) });

const connectionName = z.string().trim().min(1).max(100).openapi({
  description:
    "What the admins call this connection, for example the provider.",
});

export const createScimConnectionBody = z
  .object({
    name: connectionName,
    workspaceId: z.string().min(1).openapi({
      description:
        "The workspace this connection adds people to and removes them from.",
    }),
  })
  .strict();

const DOMAIN = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;

const domains = z
  .array(z.string().trim().toLowerCase().regex(DOMAIN, "Not a domain"))
  .min(1)
  .max(20)
  .openapi({
    description:
      "The email domains this identity provider may sign in. Subdomains count; the instance admin vouches for them.",
  });

function isSafeEntryPoint(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return true;
    return (
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1")
    );
  } catch {
    return false;
  }
}

const entryPoint = z
  .string()
  .trim()
  .max(2048)
  .refine(isSafeEntryPoint, "Use an https:// address")
  .openapi({
    description:
      "The identity provider's single sign-on URL (HTTP-Redirect binding). https is required, except on localhost.",
  });

const issuer = z.string().trim().min(1).max(1024).openapi({
  description: "The identity provider's entity ID (its Issuer).",
});

const certificate = z.string().trim().min(1).max(20000).openapi({
  description:
    "The identity provider's X.509 signing certificate, as PEM or bare base64. Public; never a private key.",
});

const connectionFields = {
  name: connectionName,
  domains,
  issuer,
  entryPoint,
  certificate,
};

export const createSamlConnectionBody = z
  .object({
    ...connectionFields,
    key: z
      .string()
      .regex(/^[a-z0-9]{10,40}$/)
      .optional()
      .openapi({
        description:
          "From GET /saml/new, so the addresses it showed stay right. Generated when left out.",
      }),
  })
  .strict();

export const updateSamlConnectionBody = z
  .object(connectionFields)
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, "Send at least one field");

export type CreateScimConnectionBody = z.infer<typeof createScimConnectionBody>;
export type CreateSamlConnectionBody = z.infer<typeof createSamlConnectionBody>;
export type UpdateSamlConnectionBody = z.infer<typeof updateSamlConnectionBody>;
