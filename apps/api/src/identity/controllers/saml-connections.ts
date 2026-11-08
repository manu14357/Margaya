import { X509Certificate } from "node:crypto";
import { createId } from "@paralleldrive/cuid2";
import { asc, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { accountTable, ssoProviderTable } from "../../database/schema";
import { recordInstanceAudit } from "../../instance-admin/audit";
import { settingsWriteLimiter } from "../../instance-admin/limits";
import { enforceRateLimits } from "../../utils/rate-limit";
import type {
  CreateSamlConnectionBody,
  UpdateSamlConnectionBody,
} from "../schema";
import { samlAcsUrl, samlMetadataUrl } from "../urls";

const HTTP_REDIRECT = "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect";
const EMAIL_NAME_ID = "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress";

type StoredSamlConfig = {
  entryPoint: string;
  cert: string;
  spMetadata: { entityID: string };
};

/** Checks the certificate; the messages never repeat what was pasted. */
function parseCertificate(input: string) {
  if (input.includes("PRIVATE KEY")) {
    throw new HTTPException(400, {
      message:
        "That is a private key. Paste the identity provider's public certificate.",
    });
  }
  const pem = input.includes("-----BEGIN")
    ? input
    : `-----BEGIN CERTIFICATE-----\n${input.replace(/\s+/g, "")}\n-----END CERTIFICATE-----`;
  let certificate: X509Certificate;
  try {
    certificate = new X509Certificate(pem);
  } catch {
    throw new HTTPException(400, {
      message: "That isn't a valid X.509 certificate.",
    });
  }
  if (new Date(certificate.validTo).getTime() <= Date.now()) {
    throw new HTTPException(400, { message: "That certificate has expired." });
  }
  return certificate;
}

/**
 * Only public values go in here: nothing signs requests or decrypts assertions.
 * The signature check itself doesn't need `wantAssertionsSigned`: the library
 * refuses a response with no valid signature on it or its assertion, and the flag
 * would also demand a signature on the response, which many providers don't add.
 */
function samlConfigOf(input: {
  providerId: string;
  issuer: string;
  entryPoint: string;
  pem: string;
  entityId: string;
}) {
  return JSON.stringify({
    issuer: input.issuer,
    entryPoint: input.entryPoint,
    cert: input.pem,
    audience: input.entityId,
    idpMetadata: {
      entityID: input.issuer,
      cert: input.pem,
      singleSignOnService: [
        { Binding: HTTP_REDIRECT, Location: input.entryPoint },
      ],
    },
    spMetadata: { entityID: input.entityId },
    wantAssertionsSigned: false,
    authnRequestsSigned: false,
    identifierFormat: EMAIL_NAME_ID,
    mapping: {
      id: "nameID",
      email: "email",
      name: "displayName",
      firstName: "givenName",
      lastName: "surname",
    },
  });
}

type Row = typeof ssoProviderTable.$inferSelect;

function viewOf(row: Row) {
  const config = JSON.parse(row.samlConfig ?? "{}") as StoredSamlConfig;
  const certificate = new X509Certificate(config.cert);
  return {
    id: row.id,
    name: row.name,
    domains: row.domain.split(","),
    issuer: row.issuer,
    entryPoint: config.entryPoint,
    certificateFingerprint: certificate.fingerprint256,
    certificateExpiresAt: new Date(certificate.validTo),
    acsUrl: samlAcsUrl(row.providerId),
    entityId: config.spMetadata.entityID,
    metadataUrl: samlMetadataUrl(row.providerId),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function findConnection(id: string) {
  const [row] = await db
    .select()
    .from(ssoProviderTable)
    .where(eq(ssoProviderTable.id, id))
    .limit(1);
  if (!row) throw new HTTPException(404, { message: "No such connection" });
  return row;
}

/** Sign-in finds the connection by domain, so a domain has only one. */
async function assertDomainsFree(domains: string[], exceptId?: string) {
  const rows = await db
    .select({
      id: ssoProviderTable.id,
      name: ssoProviderTable.name,
      domain: ssoProviderTable.domain,
    })
    .from(ssoProviderTable);
  for (const row of rows) {
    if (row.id === exceptId) continue;
    const taken = row.domain.split(",");
    const clash = domains.find((domain) =>
      taken.some(
        (other) =>
          other === domain ||
          other.endsWith(`.${domain}`) ||
          domain.endsWith(`.${other}`),
      ),
    );
    if (clash) {
      throw new HTTPException(409, {
        message: `${clash} is already used by the connection ${row.name}.`,
      });
    }
  }
}

const providerIdOf = (key: string) => `saml_${key}`;

/** Addresses for a connection that doesn't exist yet; writes nothing. */
export function draftSamlConnection() {
  const key = createId();
  const providerId = providerIdOf(key);
  return {
    key,
    acsUrl: samlAcsUrl(providerId),
    entityId: samlMetadataUrl(providerId),
  };
}

export async function listSamlConnections() {
  const rows = await db
    .select()
    .from(ssoProviderTable)
    .orderBy(asc(ssoProviderTable.createdAt));
  return { items: rows.map(viewOf) };
}

export async function createSamlConnection(
  input: CreateSamlConnectionBody,
  callerId: string,
) {
  await enforceRateLimits([[settingsWriteLimiter, callerId]]);
  const certificate = parseCertificate(input.certificate);
  const domains = [...new Set(input.domains)];
  await assertDomainsFree(domains);

  const providerId = providerIdOf(input.key ?? createId());
  const [taken] = await db
    .select({ id: ssoProviderTable.id })
    .from(ssoProviderTable)
    .where(eq(ssoProviderTable.providerId, providerId))
    .limit(1);
  if (taken) {
    throw new HTTPException(409, {
      message: "Those addresses already belong to a connection. Start again.",
    });
  }

  const [row] = await db
    .insert(ssoProviderTable)
    .values({
      providerId,
      name: input.name,
      issuer: input.issuer,
      domain: domains.join(","),
      domainVerified: true,
      samlConfig: samlConfigOf({
        providerId,
        issuer: input.issuer,
        entryPoint: input.entryPoint,
        pem: certificate.toString(),
        entityId: samlMetadataUrl(providerId),
      }),
      userId: callerId,
    })
    .returning();
  if (!row) throw new Error("The connection was not created");

  await recordInstanceAudit({
    action: "saml.connection_created",
    target: { type: "saml_connection", id: row.id, label: input.name },
    metadata: { domains, issuer: input.issuer },
    actor: { userId: callerId },
  });
  return viewOf(row);
}

export async function updateSamlConnection(
  id: string,
  input: UpdateSamlConnectionBody,
  callerId: string,
) {
  await enforceRateLimits([[settingsWriteLimiter, callerId]]);
  const current = await findConnection(id);
  const config = JSON.parse(current.samlConfig ?? "{}") as StoredSamlConfig;
  const pem = input.certificate
    ? parseCertificate(input.certificate).toString()
    : config.cert;
  const domains = input.domains ? [...new Set(input.domains)] : null;
  if (domains) await assertDomainsFree(domains, id);

  const issuer = input.issuer ?? current.issuer;
  const [row] = await db
    .update(ssoProviderTable)
    .set({
      name: input.name ?? current.name,
      issuer,
      domain: domains ? domains.join(",") : current.domain,
      samlConfig: samlConfigOf({
        providerId: current.providerId,
        issuer,
        entryPoint: input.entryPoint ?? config.entryPoint,
        pem,
        // Stays fixed: the identity provider was configured with it.
        entityId: config.spMetadata.entityID,
      }),
    })
    .where(eq(ssoProviderTable.id, id))
    .returning();
  if (!row) throw new HTTPException(404, { message: "No such connection" });

  await recordInstanceAudit({
    action: "saml.connection_updated",
    target: { type: "saml_connection", id, label: row.name },
    metadata: { changed: Object.keys(input) },
    actor: { userId: callerId },
  });
  return viewOf(row);
}

/**
 * Stops SAML sign-in through this provider. Accounts stay, and their people sign
 * in another way; sign-in links to it are removed so nothing dangles.
 */
export async function deleteSamlConnection(id: string, callerId: string) {
  await enforceRateLimits([[settingsWriteLimiter, callerId]]);
  const connection = await findConnection(id);
  await db.transaction(async (tx) => {
    await tx
      .delete(accountTable)
      .where(eq(accountTable.providerId, connection.providerId));
    await tx.delete(ssoProviderTable).where(eq(ssoProviderTable.id, id));
  });
  await recordInstanceAudit({
    action: "saml.connection_deleted",
    target: { type: "saml_connection", id, label: connection.name },
    actor: { userId: callerId },
  });
  return { id, deleted: true as const };
}
