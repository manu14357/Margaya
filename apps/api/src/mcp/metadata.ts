// OAuth discovery documents for the protected resources Margaya serves to
// agents (the MCP endpoint and the A2A endpoint), and the resource indicator
// check (RFC 8707) the authorization endpoints share.

/** The API's public origin, without a trailing /api. */
export function publicApiOrigin(): string {
  return (process.env.MARGAYA_API_URL || "http://localhost:1337")
    .replace(/\/api\/?$/, "")
    .replace(/\/+$/, "");
}

/** The authorization server's issuer identifier (RFC 8414, RFC 9207). */
export function oauthIssuer(baseUrl = publicApiOrigin()): string {
  return `${baseUrl}/api`;
}

// Paths a client may name as the resource it wants a token for.
const RESOURCE_PATHS = new Set(["", "/api", "/api/mcp", "/api/a2a"]);

/**
 * Whether `value` is a valid resource indicator for this instance: an
 * absolute URL without a fragment whose path is one of Margaya's protected
 * resources. The origin is not compared, so a deployment whose public URL is
 * configured differently from what clients see keeps working; access tokens
 * are instance-wide either way.
 */
export function isMargayaResource(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.hash || url.username || url.password) return false;
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    return RESOURCE_PATHS.has(url.pathname.replace(/\/+$/, ""));
  } catch {
    return false;
  }
}

/** Protected resource metadata (RFC 9728) for /api/mcp or /api/a2a. */
export function protectedResourceMetadata(
  baseUrl: string,
  resource: "mcp" | "a2a",
) {
  return {
    resource: `${baseUrl}/api/${resource}`,
    authorization_servers: [oauthIssuer(baseUrl)],
    bearer_methods_supported: ["header"],
    resource_name: resource === "mcp" ? "Margaya MCP" : "Margaya A2A",
    resource_documentation: `https://margaya.app/docs/core/integrations/${resource}`,
  };
}

/** Authorization server metadata (RFC 8414). */
export function authorizationServerMetadata(baseUrl: string) {
  return {
    issuer: oauthIssuer(baseUrl),
    authorization_endpoint: `${baseUrl}/api/mcp/authorize`,
    token_endpoint: `${baseUrl}/api/mcp/token`,
    registration_endpoint: `${baseUrl}/api/mcp/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    // The authorization response carries `iss` (RFC 9207).
    authorization_response_iss_parameter_supported: true,
    // An https client_id names the client's metadata document (MCP
    // 2026-07-28); registration_endpoint stays for older clients.
    client_id_metadata_document_supported: true,
  };
}
