import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";
import { SamlLib } from "samlify";

// A stand-in identity provider for the SAML tests: it writes and signs the XML a
// real one would post. It is not a real provider, so what these tests prove is
// how this server treats responses, not that a given product interoperates.
// (One real provider was also tried by hand; see the SAML docs page.)
// The keys in fixtures/saml are throwaway test keys, used nowhere else.

const fixtures = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/saml",
);
const fixture = (name: string) => readFileSync(resolve(fixtures, name), "utf8");

export const IDP_CERT = fixture("idp.crt");
export const IDP_KEY = fixture("idp.key");
export const OTHER_CERT = fixture("other.crt");
export const OTHER_KEY = fixture("other.key");

export const IDP_ISSUER = "https://idp.example.test/entity";
export const IDP_ENTRY_POINT = "https://idp.example.test/sso";

const bareCertificate = (pem: string) =>
  pem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, "").replace(/\s+/g, "");

const RSA_SHA256 = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";
const RSA_SHA1 = "http://www.w3.org/2000/09/xmldsig#rsa-sha1";

/** Inflates the SAMLRequest in a redirect URL and returns what the IdP needs. */
export function readAuthnRequest(url: string) {
  const parsed = new URL(url);
  const samlRequest = parsed.searchParams.get("SAMLRequest");
  if (!samlRequest) throw new Error(`No SAMLRequest in ${url}`);
  const xml = inflateRawSync(Buffer.from(samlRequest, "base64")).toString();
  const id = xml.match(/\sID="([^"]+)"/)?.[1];
  if (!id) throw new Error(`No request ID in ${xml}`);
  return {
    id,
    xml,
    destination: `${parsed.origin}${parsed.pathname}`,
    relayState: parsed.searchParams.get("RelayState"),
  };
}

export type ResponseOptions = {
  acsUrl: string;
  audience: string;
  email: string;
  inResponseTo?: string | null;
  issuer?: string;
  nameId?: string;
  attributes?: Record<string, string>;
  notOnOrAfter?: Date;
  recipient?: string;
  sign?: "assertion" | "response" | "none";
  key?: string;
  cert?: string;
  sha1?: boolean;
  /** How far the identity provider's clock runs ahead of this server's. */
  clockAheadMs?: number;
};

/** A base64 SAMLResponse, signed like an IdP would unless told otherwise. */
export function samlResponse(options: ResponseOptions): string {
  const now = new Date(Date.now() + (options.clockAheadMs ?? 0));
  const later = options.notOnOrAfter ?? new Date(now.getTime() + 5 * 60_000);
  const earlier = new Date(now.getTime() - 60_000);
  const issuer = options.issuer ?? IDP_ISSUER;
  const assertionId = `_a${crypto.randomUUID().replaceAll("-", "")}`;
  const responseId = `_r${crypto.randomUUID().replaceAll("-", "")}`;
  const inResponseTo = options.inResponseTo
    ? ` InResponseTo="${options.inResponseTo}"`
    : "";
  const attributes = Object.entries(options.attributes ?? {})
    .map(
      ([name, value]) =>
        `<saml:Attribute Name="${name}"><saml:AttributeValue>${value}</saml:AttributeValue></saml:Attribute>`,
    )
    .join("");

  const xml = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${responseId}" Version="2.0" IssueInstant="${now.toISOString()}" Destination="${options.acsUrl}"${inResponseTo}><saml:Issuer>${issuer}</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status><saml:Assertion ID="${assertionId}" Version="2.0" IssueInstant="${now.toISOString()}"><saml:Issuer>${issuer}</saml:Issuer><saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${options.nameId ?? options.email}</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData NotOnOrAfter="${later.toISOString()}" Recipient="${options.recipient ?? options.acsUrl}"${inResponseTo}/></saml:SubjectConfirmation></saml:Subject><saml:Conditions NotBefore="${earlier.toISOString()}" NotOnOrAfter="${later.toISOString()}"><saml:AudienceRestriction><saml:Audience>${options.audience}</saml:Audience></saml:AudienceRestriction></saml:Conditions><saml:AuthnStatement AuthnInstant="${now.toISOString()}" SessionIndex="_s1"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement><saml:AttributeStatement>${attributes}</saml:AttributeStatement></saml:Assertion></samlp:Response>`;

  const sign = options.sign ?? "assertion";
  if (sign === "none") return Buffer.from(xml).toString("base64");

  const assertionPath =
    "/*[local-name(.)='Response']/*[local-name(.)='Assertion']";
  const responsePath = "/*[local-name(.)='Response']";
  return SamlLib.constructSAMLSignature({
    rawSamlMessage: xml,
    referenceTagXPath: sign === "assertion" ? assertionPath : responsePath,
    privateKey: options.key ?? IDP_KEY,
    signingCert: bareCertificate(options.cert ?? IDP_CERT),
    signatureAlgorithm: options.sha1 ? RSA_SHA1 : RSA_SHA256,
    isBase64Output: true,
    signatureConfig: {
      prefix: "ds",
      location: {
        reference: `${sign === "assertion" ? assertionPath : responsePath}/*[local-name(.)='Issuer']`,
        action: "after",
      },
    },
  } as Parameters<typeof SamlLib.constructSAMLSignature>[0]) as string;
}

/** What the browser posts to the assertion endpoint from the IdP's page. */
export function samlPostBody(
  samlResponseValue: string,
  relayState?: string | null,
) {
  const body = new URLSearchParams({ SAMLResponse: samlResponseValue });
  if (relayState) body.set("RelayState", relayState);
  return body.toString();
}
