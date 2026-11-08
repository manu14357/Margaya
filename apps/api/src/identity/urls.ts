// The addresses an identity provider is configured with. They use the same
// base as Better Auth (auth.ts): the API's origin plus /api/auth.
function authBaseUrl(): string {
  const apiUrl = process.env.MARGAYA_API_URL || "http://localhost:1337";
  try {
    return `${new URL(apiUrl).origin}/api/auth`;
  } catch {
    return `${apiUrl.split("/").slice(0, 3).join("/")}/api/auth`;
  }
}

export const scimBaseUrl = () => `${authBaseUrl()}/scim/v2`;

export const samlAcsUrl = (providerId: string) =>
  `${authBaseUrl()}/sso/saml2/sp/acs/${providerId}`;

export const samlMetadataUrl = (providerId: string) =>
  `${authBaseUrl()}/sso/saml2/sp/metadata?providerId=${providerId}`;
